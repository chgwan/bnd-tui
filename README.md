# bnd-tui — 纯终端百度网盘客户端(官方内核)

- **日期:** 2026-11-04
- **状态:** MVP(M0–M2)
- **设计文档:** `docs/superpowers/specs/2026-11-04-bnd-tui-design.md`

## 这是什么

用 Node.js + koffi 直接驱动**官方客户端自带的内核**(`libbrowserengine.so`,431 个 C 导出函数)的终端客户端。与官方 GUI 内部做法同构:握手、签名、设备指纹、TLS 全部来自官方 .so,服务端无法区分,不走第三方 API、不受其限流影响。

- 无 GUI、无显示服务器、无 root;内核 init 实测 60ms
- 单发命令与交互 shell(REPL)双模式

## 安装

两种安装形态,按需选择:

```bash
# 轻量安装(默认,~10MB):登录引导 / ls / 上传下载 / 任务面板
cd ~/Codes/bnd-tui
npm install
node bin/bnd.js version        # 应输出 1.3.7.20

# full 安装(追加 playwright + Chromium,约 400MB):启用终端扫码登录
npm run install:full
```

- 组件以 `--no-save` 方式追加,不改动 package.json;重新 `npm install` 后若扫码失效,再跑一次 `npm run install:full`
- Chromium 由 playwright 下载到 `~/.cache/ms-playwright`,启动时自动复用官方客户端 deps 目录里的运行库

前提:官方客户端解包在 `~/opt/baidunetdisk`(只读复用,永不修改)。

### 单文件可执行

```bash
npm run build     # 生成 dist/bnd(约 122MB,内含 Node 运行时和全部 JS 依赖)
dist/bnd ls /
```

- 不需要安装 Node,首次运行解压约 24MB 到 `~/.cache/bnd-tui`
- 构建需要 `gcc`,用于编译内核垫片 `native/bnd-shim.so`。从源码运行时先执行 `npm run build:shim`,否则启动有约 3% 概率崩溃
- 构建时会把当前 `node_modules` 打进去,要扫码登录需先跑 `npm run install:full`
- 官方客户端、Xvfb、playwright 的 Chromium 仍是外部依赖,不打包;目标机需要 glibc 2.28 及以上和系统 `tar`

## 使用

```bash
node bin/bnd.js login --bduss <BDUSS> --stoken <STOKEN>   # 引导登录(见下)
node bin/bnd.js whoami                                     # 当前用户(免内核)
node bin/bnd.js ls /                                       # 列目录
node bin/bnd.js ls /某目录 -?     # 见 help
node bin/bnd.js download /远端/文件 --to ~/Downloads/bnd   # 下载(官方 P2SP 引擎)
node bin/bnd.js upload ~/file.zip --to /远端目录           # 上传
node bin/bnd.js rm /远端/文件                              # 删除文件(进回收站,不删目录)
node bin/bnd.js tasks                                      # 任务面板
node bin/bnd.js tasks --watch                              # 实时刷新,无运行中的任务时结束
node bin/bnd.js tasks pause|resume|delete|top <ID...>      # 任务控制
node bin/bnd.js                                            # 进入交互 shell
node bin/bnd.js logout
```

### 方式一:终端扫码(full 安装)

```bash
node bin/bnd.js login
```

无头 Chromium 在后台打开官方登录页(maclogin),二维码渲染到终端,手机扫码确认后自动完成登录。

### 方式二:引导登录(轻量安装)

1. 浏览器打开 `pan.baidu.com` 并登录(可扫码)
2. DevTools → Application → Cookies → 复制 `BDUSS` 与 `STOKEN` 两个值
3. `node bin/bnd.js login --bduss XXX --stoken YYY`

两种方式登录态都持久化在 `~/.config/bnd-tui/credentials.json`(0600),之后所有命令自动恢复,无需重复登录。

## 与官方 GUI 的关系

内核的 `netdisk_service` 是**单例、后启动者接管**。默认情况下检测到官方客户端或另一个 `bnd` 在跑会拒绝启动,上次运行留下的孤儿服务(PPID 为 1)不受影响;确认无碍可加 `--coexist`:

```bash
node bin/bnd.js ls / --coexist
```

## 已知边界(MVP)

- 下载/上传 payload 的键名以官方现场为准,若官方升级后行为异常,重跑 `npm run glue` 重新生成内核绑定
- 传输并发数与 P2P 开关的命令化配置在 M3
- 密码登录、分享转存、回收站、搜索在 M3

## 项目结构

- `src/kernel/` — 引擎加载、glue(生成物)、事件总线、错误码、init/uninit
- `src/auth/` — 登录态、登录流程
- `src/shell/` — REPL、注册表、各命令
- `scripts/make-glue.mjs` — 从官方 asar 重新生成 `glue.gen.js`
- `docs/recon/` — 逆向侦察存档(导出表、签名、实验记录)
- `tests/` — `node scripts/run-tests.js`(98 个用例)
