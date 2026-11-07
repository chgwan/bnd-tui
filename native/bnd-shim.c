// 绕开官方内核启动时的两处竞态。经 LD_PRELOAD 加载,不改动磁盘上的官方文件。
//
// 1. libkernel.so:set_param 设置用户 ID 时会生成日志上传 URL,这段字符串操作与
//    其他线程竞争,实测约 4% 的启动崩溃在此。这里让入口函数直接返回。
//    偏移绑定内核版本,字节不匹配就不打补丁,行为退回官方原样。
// 2. libbrowserengine.so:剪贴板线程不检查 XOpenDisplay 的返回值,而它偶发失败、
//    稍后重试即成功。这里替内核重试。
#define _GNU_SOURCE
#include <dlfcn.h>
#include <link.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <time.h>
#include <unistd.h>

#define URL_SETUP_OFFSET 0x5f4e00UL
#define X_RETRIES 20
#define X_RETRY_NS 50000000L

static const unsigned char URL_SETUP_PROLOGUE[] = {
    0x41, 0x56, 0x53, 0x50, 0x48, 0x8d, 0x1d, 0xa5, 0x04, 0x09, 0x01, 0x48, 0x8b, 0x3b,
};

static int find_libkernel(struct dl_phdr_info *info, size_t size, void *base) {
  (void)size;
  if (!strstr(info->dlpi_name, "libkernel.so")) return 0;
  *(unsigned long *)base = info->dlpi_addr;
  return 1;
}

static void skip_url_setup(void) {
  static int done;
  unsigned long base = 0;
  if (done) return;
  dl_iterate_phdr(find_libkernel, &base);
  if (!base || __sync_lock_test_and_set(&done, 1)) return;

  unsigned char *entry = (unsigned char *)(base + URL_SETUP_OFFSET);
  if (memcmp(entry, URL_SETUP_PROLOGUE, sizeof URL_SETUP_PROLOGUE)) return;

  // 全程保留执行权限:其他线程此时可能在同一页上运行
  unsigned long page_size = (unsigned long)sysconf(_SC_PAGESIZE);
  void *page = (void *)((unsigned long)entry & ~(page_size - 1));
  if (mprotect(page, page_size, PROT_READ | PROT_WRITE | PROT_EXEC)) return;
  *entry = 0xc3;  // ret
  mprotect(page, page_size, PROT_READ | PROT_EXEC);
}

void *dlopen(const char *path, int flags) {
  static void *(*real)(const char *, int);
  if (!real) real = dlsym(RTLD_NEXT, "dlopen");
  void *handle = real(path, flags);
  skip_url_setup();
  return handle;
}

void *XOpenDisplay(const char *name) {
  static void *(*real)(const char *);
  // libX11 由内核以局部作用域加载,RTLD_NEXT 找不到
  if (!real) real = dlsym(dlopen("libX11.so.6", RTLD_NOW | RTLD_NOLOAD), "XOpenDisplay");
  if (!real) return NULL;

  void *display = real(name);
  for (int i = 0; !display && i < X_RETRIES; i++) {
    struct timespec delay = {0, X_RETRY_NS};
    nanosleep(&delay, NULL);
    display = real(name);
  }
  return display;
}

// 只有 bnd 进程需要垫片,摘掉自己以免传给 Xvfb、Chromium、netdisk_service
__attribute__((constructor)) static void remove_self_from_env(void) {
  const char *preload = getenv("LD_PRELOAD");
  const char *rest = preload ? strchr(preload, ':') : NULL;
  if (rest) setenv("LD_PRELOAD", rest + 1, 1);
  else unsetenv("LD_PRELOAD");
}
