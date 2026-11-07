// 绕开官方内核启动时的两处竞态。经 LD_PRELOAD 加载,不改动磁盘上的官方文件。
//
// 1. libkernel.so:set_param 设置用户 ID 时会生成日志上传 URL,这段字符串操作与
//    其他线程竞争,实测约 4% 的启动崩溃在此。这里让入口函数直接返回。
//    偏移绑定内核版本,字节不匹配就不打补丁,行为退回官方原样。
// 2. libbrowserengine.so:剪贴板线程不检查 XOpenDisplay 的返回值,而它偶发失败、
//    稍后重试即成功。这里替内核重试。
// 3. 没有 X 时(无 DISPLAY、也没有 Xvfb),内核两处读剪贴板的代码都会解引用
//    NULL 的 Display 而崩溃。这时让监控线程直接返回(与它收到停止信号后的
//    返回值一致),让读取函数返回失败(调用方都检查了返回值)。bnd 用不到剪贴板。
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

#define CLIPBOARD_THREAD_OFFSET 0x8e4a50UL
#define CLIPBOARD_READ_OFFSET 0x8e4b30UL

static const unsigned char CLIPBOARD_THREAD_PROLOGUE[] = {
    0x41, 0x54, 0x55, 0x31, 0xff, 0x53, 0x48, 0x81, 0xec, 0xd0, 0x00, 0x00, 0x00, 0xe8,
};

static const unsigned char CLIPBOARD_READ_PROLOGUE[] = {
    0x41, 0x57, 0x41, 0x56, 0x41, 0x55, 0x41, 0x54, 0x55, 0x53,
    0x48, 0x81, 0xec, 0xb8, 0x01, 0x00, 0x00, 0x48,
};

struct lib_query {
  const char *name;
  unsigned long base;
};

static int find_lib(struct dl_phdr_info *info, size_t size, void *data) {
  (void)size;
  struct lib_query *q = data;
  if (!strstr(info->dlpi_name, q->name)) return 0;
  q->base = info->dlpi_addr;
  return 1;
}

// 在 lib 的 offset 处校验 prologue,匹配才写入 code;每个补丁只尝试一次
static void patch_once(int *done, const char *lib, unsigned long offset,
                       const unsigned char *prologue, size_t prologue_len,
                       const unsigned char *code, size_t code_len) {
  struct lib_query q = {lib, 0};
  if (*done) return;
  dl_iterate_phdr(find_lib, &q);
  if (!q.base || __sync_lock_test_and_set(done, 1)) return;

  unsigned char *entry = (unsigned char *)(q.base + offset);
  if (memcmp(entry, prologue, prologue_len)) return;

  // 全程保留执行权限:其他线程此时可能在同一页上运行
  unsigned long page_size = (unsigned long)sysconf(_SC_PAGESIZE);
  unsigned long first = (unsigned long)entry & ~(page_size - 1);
  unsigned long last = ((unsigned long)entry + code_len - 1) & ~(page_size - 1);
  size_t len = last - first + page_size;
  if (mprotect((void *)first, len, PROT_READ | PROT_WRITE | PROT_EXEC)) return;
  memcpy(entry, code, code_len);
  mprotect((void *)first, len, PROT_READ | PROT_EXEC);
}

static void apply_patches(void) {
  static int url_done, clipboard_thread_done, clipboard_read_done;
  static const unsigned char ret[] = {0xc3};
  static const unsigned char return_one[] = {0xb8, 0x01, 0x00, 0x00, 0x00, 0xc3};  // mov eax,1; ret
  static const unsigned char return_zero[] = {0x31, 0xc0, 0xc3};                   // xor eax,eax; ret

  patch_once(&url_done, "libkernel.so", URL_SETUP_OFFSET,
             URL_SETUP_PROLOGUE, sizeof URL_SETUP_PROLOGUE, ret, sizeof ret);
  if (getenv("DISPLAY")) return;
  patch_once(&clipboard_thread_done, "libbrowserengine.so", CLIPBOARD_THREAD_OFFSET,
             CLIPBOARD_THREAD_PROLOGUE, sizeof CLIPBOARD_THREAD_PROLOGUE,
             return_one, sizeof return_one);
  patch_once(&clipboard_read_done, "libbrowserengine.so", CLIPBOARD_READ_OFFSET,
             CLIPBOARD_READ_PROLOGUE, sizeof CLIPBOARD_READ_PROLOGUE,
             return_zero, sizeof return_zero);
}

void *dlopen(const char *path, int flags) {
  static void *(*real)(const char *, int);
  if (!real) real = dlsym(RTLD_NEXT, "dlopen");
  void *handle = real(path, flags);
  apply_patches();
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
