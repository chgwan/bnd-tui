# bnd-tui 执行进度总结

- **日期:** 2026-11-04
- **状态:** M0–M2 代码全部完成(98/98 单测绿);真实账号已跑通登录、`ls`、上传、下载、任务控制、REPL,启动崩溃已由垫片绕开
- **计划:** `docs/superpowers/plans/2026-11-04-bnd-tui-mvp.md`
- **设计:** `docs/superpowers/specs/2026-11-04-bnd-tui-design.md`

## 一、已交付(全部经实测/单测验证)

| 模块 | 内容 | 状态 |
|---|---|---|
| 内核加载 | koffi 加载官方 `libbrowserengine.so`,`bnd version` → 1.3.7.20 | ✅ 实测 |
| glue 生成器 | `make-glue.mjs` 从官方 asar 机械提取:345 函数 / 130 回调原型 / disposable | ✅ 单测 |
| 生命周期 | headless init 0.06s / 干净 uninit / GUI 守卫(单例互斥,`--coexist` 覆盖)/ SIGINT 安全退出 | ✅ 实测 |
| 错误码/事件总线 | 官方错误表中文映射;CommonEvent/InternalLog 回调注册与分发 | ✅ 单测 |
| 配置/格式化 | `~/.config/bnd-tui/config.json`(0600);大小/速度/进度条 | ✅ 单测 |
| 登录态 | 凭证规范化(官方 JSON 形状)、持久化、恢复、登出 | ✅ 单测 |
| 文件浏览 | `ls`(分页聚合、中文名)/`cd`/路径解析 | ✅ 实测 |
| 传输 | `download`/`upload`,文件夹下载,断点续传;单发模式等待完成并显示进度条 | ✅ 实测(往返逐字节一致) |
| 删除 | `rm <远端文件...>`,走 `/api/filemanager`,进回收站,拒绝目录 | ✅ 实测 |
| 任务面板 | `tasks [--watch]` + pause/resume/delete/top;REPL 中传输后台运行,可查看和控制 | ✅ 实测 |
| REPL + 注册表 | 交互 shell、补全、历史;单发模式共用注册表 | ✅ 实测 |
| 安装分层 | 基础 `npm install`(仅 koffi)/ `install:full`(playwright+pngjs+Chromium,扫码登录) | ✅ 实测 |

## 二、扫码登录攻坚记录(今日主战场)

按时间序的问题与修复,每一条都已实证:

1. **maclogin 重定向营销页** → 自动点击“去登录”唤出 passport 登录框
2. **二维码获取竞态**(解码完成 ≠ 合成器已绘制)→ 墨水比例验收循环
3. **页签自动切换**(扫码/密码互跳)→ 全程自愈 + 保活 + 二维码过期自动刷新重画
4. **二维码尺寸**:73×73 模块(v13)大码 —— 模块级渲染(检测栅距、按模块采样);默认 1× 小码(用户要求,手机实测可扫),`BND_QR_SCALE=2` 可选;自动备好 810×810 大图 `/tmp/bnd-qr-big.png`
5. **扫码后 cookie 捕获**:已解决(心跳诊断可见 BDUSS/STOKEN 逐步落罐,域优先级取值)
6. **loginStatus 接口 errno:2(参数错误)**:此前判定“接口格式已变”是**错的**。官方 `post(url, {}, x)` 的第 3 参是内核 HTTP 的 cookie 覆盖,不是请求体;我们把 cookie JSON 当请求体发,且缺 `COMMON_PARAM`
7. **`set_login_state` 返回 7(参数无效)**:三处实现与官方不符,已按官方序列重写(见下)
   - `sign_key` 误用 `get_login_auth_param` 的返回值。该返回值是 passport 查询串;官方 `sign_key` 是 `/api/report/user`(`action=pc_uniyunguanjia_login`)响应的 `uinfo` 字段
   - `errno=362` 不是错误。官方以 `out[0] > 0` 判成功,该值疑似输出长度
   - `ukFromBduss` 基于虚构格式,真实 BDUSS 上返回空串,已删除。官方 `uk/wdr/mdr` 来自 `/api/account/uinfo?udr=1`
8. **STOKEN 取值时机**:进入 pan 前读到的可能是 passport 域的值,现改为访问 pan 后重读,并打印来源域

9. **`set_login_state` 段错误**:内核剪贴板监控线程调用 `XOpenDisplay` 后不检查 NULL(`libbrowserengine.so` 偏移 `0x8e4a5d`),无 `DISPLAY` 时 `XInternAtom(NULL)` 崩溃。无桌面环境下现启动私有 Xvfb(`src/kernel/display.js`)
10. **已登录后 `global_uninit` 段错误**:线程跳到未映射地址。现改走官方退出超时路径 `browser_engine_electron_begin_uninit` 后由进程退出收尾
11. **Xvfb 生命周期**:退出时杀 Xvfb 会令 Xlib 在内核线程里调 `exit()` 而崩溃;`-terminate` 会被任何短连接(Chromium、内核自身)触发退出,内核随后拿到 NULL display;共用 display 号会让旧实例删掉新 socket。现由 `sh` 看门狗经 stdin 管道持有 Xvfb,bnd 退出后才杀,并按 PID 分配 display 号。Chromium 环境去掉 `DISPLAY`
12. **缺 `set_config`**:官方在 `global_init` 后设置 `BEOPT_COMMONPARAM`,此前缺失导致请求的 `channel` 为空。已补上;`APP_VERSION` 为常量,升级 deb 后需同步

13. **`ls` 三处错误**:等待回调时事件循环为空,Node 退出并卸载原生库(已加超时定时器保活);回调参数位置写错,把 JSON 长度当错误码(真实顺序见 `src/shell/commands/ls.js`);内核文件对象没有 `server_filename`,数值字段全是字符串(已在入口规范化)
15. **登录时 `set_login_state` 段错误(真实扫码 4 次全中)**:`kernelPost` 在内核回调栈内 `resolve`,续体重入内核。现用 `setImmediate` 推迟到回调返回后。完整登录路径 4/6 变为 8/8
16. **崩溃提示**:`bin/bnd.js` 不再转发崩溃信号,改为中文提示并退出码 1
14. **退出竞态**:已登录时 `exit()` 的静态析构与内核线程竞争,现用 `_exit` 结束进程(`exitProcess`)

17. **缺 `XInitThreads`**:内核多线程并发调 Xlib,未初始化时 `XOpenDisplay` 偶发返回 NULL。已在 `initKernel` 调用
18. **传输与任务按官方重写**:任务函数首参是 `cid`、次参是 `isDownload`;下载走 `download_files_by_check`(失败回退 `download_self_files`),payload 为条目数组;上传走 `upload_files`;`--to` 缺省时不再吞掉第一个路径;REPL 改为顺序执行并等待结束;`ls` 时间改用本地时区
19. **`loginStatus` 经内核可用**:`login_info` 含用户名与会员信息,`whoami` 与登录均已使用,此前的 `fetchLoginStatus` 已删除

20. **任务恢复**:内核在登录后约数秒内异步恢复未完成任务,恢复后运行中的任务会自动继续。`bnd tasks` 单发时已等待恢复

断点续传实测(2026-11-05,256MB 随机文件,全部下载回来逐字节比对一致):

| 中断方式 | 下载 | 上传 |
|---|---|---|
| SIGTERM | 重跑接上,约 120MB 起,21 秒完成 | 重跑接上,约 209MB 起,195 秒完成 |
| `kill -9` | 重跑接上,约 120MB 起,18 秒完成 | 重跑接上,约 233MB 起,127 秒完成 |
| 暂停后退出 | 任务保留,74% 恢复,20 秒完成 | 任务保留,75% 恢复,188 秒完成 |

- **上传速度:** 256MB 全量 355–400 秒。开头几秒冲到 40% 以上,之后每隔几十秒跳一格,进度长时间不动不等于卡死
- **上传进度条偏高:** 开头的数值不可靠,5 秒内打断后重跑会从 192MB 退回 36MB,暂停时会退到 13%
- **任务库残留锁:** `upload.db-shm` 第 128 字节(SQLite DMS)曾留下一把无主写锁,库初始化报 `SQLITE_PROTOCOL`,上传任务不保存。内核启动前 `src/kernel/stale-shm.js` 会删除这种 `-shm`,`--coexist` 时跳过。锁怎么留下的未查明,`kill -9` 和 SIGTERM 各试一次都没有复现
- **内核日志:** `BaiduKernel_*` 逐字节异或 `0x8a`;`MXLog_*` 是 UTF-16,前 6 字节后为“4 字节长度 + 内容”,内容循环异或 `baidu_lo`,上传库的错误只在这里
- **SIGTERM 偶发失效:** 上传第 200 秒发信号 3 次,1 次被忽略,进程传完后以 0 退出,说明 `onSignal` 没跑。原因未查明:内核只在启动时覆盖一次 SIGTERM,40 次启动都早于重新接管;随后在第 8–90 秒随机打断 24 次,全部 0.1 秒内退出,没有复现
- **`filecache.db` 疑似索引损坏:** 内核清理 `file_meta` 时报 `database disk image is malformed`。只是文件列表缓存,不影响传输;官方排序规则 `baidunetdisksort` 是私有的,外部无法做准确的完整性检查

官方登录序列:`uinfo?udr=1` → `report/user` → `set_login_state`,两个请求都经内核 `browser_engine_http_upload_memory` 发出(`src/auth/kernelhttp.js`)。

实验已证实:空 `uk` 时 `set_login_state` 返回 7。真实账号下 `uinfo`、`report/user` 均成功,凭证已落盘。

**当前卡点:** 暂无阻塞问题。

## 下载库卡死

2026-11-05 真实目录的 `~/.config/baidunetdisk/BaiduYunKernel/Config/download.s3dbe` 自 15:51 起不再更新,下载固定报 `1250004`。文件内容没坏,也查不到文件锁,删除 `-journal` 无效;用同样内容换一个新 inode 后立即恢复,机制未查明。

再次出现时的处理:退出 bnd,把这个文件 `cp -p` 成新文件再 `mv` 回原名,并删除 `-journal`。

## 内核启动竞态与垫片

`native/bnd-shim.c` 经 `LD_PRELOAD` 加载,不改磁盘上的官方文件,处理官方内核的两处竞态。`BND_NO_SHIM=1` 可关闭。

- **`libkernel.so`**:`set_param` 设置用户 ID 时生成日志上传 URL,这段字符串操作与其他线程竞争。垫片把入口 `0x5f4e00` 改成 `ret`,校验 14 字节,不匹配时不打补丁。另一线程是谁未查明
- **X11**:内核两个线程几乎同时调 `XOpenDisplay(NULL)`,偶发返回 NULL,而 `0x8e4a5d` 处不检查。垫片失败时重试,最多 1 秒。失败原因未查明,已排除环境变量竞态

实测(`dist/bnd ls /`,交替运行):有垫片 0/340 崩溃,无垫片 11/340。进程内确认入口字节为 `c3`,子进程环境无 `LD_PRELOAD`,跳过后上传和下载正常。

## 任务与信号

- **结果只看本次任务**:`createTaskTracker` 忽略没变化的旧失败和旧暂停任务。内核对同一文件复用旧任务,状态变过或收到 end 事件的算本次。启动前要等队列恢复,所以队列为空时 `download` 多等约 3 秒
- **控制命令等生效**:内核异步执行,列表先变、落盘在后,单发 `pause`/`resume`/`delete` 生效后再等 1 秒才退出,否则任务下次启动又会回来。不存在的 ID 会报错
- **信号**:内核启动时覆盖 SIGINT/SIGTERM 处理器,Node 收不到信号,传输中断不了。`ensureKernel` 结束时重新注册,`bin/bnd.js` 把信号转发给子进程。内核启动的短窗口内收到的信号仍可能丢失(见过一次,推断如此)

## 单文件可执行

`npm run build` 用 Node SEA 生成 `dist/bnd`,首次运行把应用解压到 `~/.cache/bnd-tui`。已实测 `version`、`whoami`、`ls`、`tasks`、REPL、二维码显示和并发首次运行。

## 三、接下来的事

- [x] 用户完成一次完整扫码,`whoami`、`ls` 正常
- [ ] 确认哪些退出路径会留下 `netdisk_service`:崩溃和 `kill -9` 一定会留下,未登录的 `version` 干净退出不会。守卫已放行孤儿,此项只影响进程残留
- [ ] 实测 `logout`
- [ ] 查明 SIGTERM 偶发失效
- [ ] 最终整体代码评审(执行计划流程要求)
- [ ] M3:密码登录、分享转存、回收站、搜索、config 命令化、并发/P2P 配置

## 四、重要运维事实(排障时先看这里)

- `netdisk_service` 为单例、**后启动者接管**;bnd 默认检测到官方 GUI 或父进程存活的服务会拒绝启动(`--coexist` 强制)
- 无桌面环境需要 Xvfb;排查原生崩溃时 ptrace 不可用,可用 `LD_PRELOAD` 信号库抓 RIP 与内存映射
- 孤儿 `netdisk_service`(PPID 为 1)不触发守卫
- `npm install`(含 `--no-save`)**会修剪**此前 `--no-save` 装的包 —— 重装组件跑 `npm run install:full`
- 官方 deb 升级后:重跑 `npm run glue` 重新生成内核绑定
- 侦察存档:`docs/recon/`(导出表、koffi 签名、init 实验);执行台账:`.superpowers/sdd/2026-11-04-bnd-tui-mvp/progress.md`

## 五、基本实现原理

### 5.1 一句话

**官方 Linux 客户端 = Electron 界面 + FFI 直调原生内核;bnd-tui 把界面换成终端,FFI 以下一字不改地复用官方内核。**

### 5.2 逆向发现(原理的地基)

对官方 deb 解包(`~/opt/baidunetdisk`)侦察得出的关键事实:

- `opt/baidunetdisk/libbrowserengine.so` —— 内核引擎封装,导出 **431 个 `browser_engine_*` C 函数**,JSON-in/JSON-out;构建路径泄露其血统:`baidu_net_disk_pc-sdk-mojo`(官方内部 PC SDK)
- `libkernel.so` —— P2SP 传输引擎(`create_p2sp_task`/`yunp2p_init`/`load_btsdk`),即官方限速豁免的传输通道本体
- 官方 GUI 的 JS 主进程(解包 `core.asar` 得 `main.js`)**本身就是用 koffi FFI 调 `libbrowserengine.so`**——324 个函数签名声明、初始化时序、错误码表全部在内
- `netdisk_service` 是内核自行管理的本地辅助守护进程(单例)
- **全部网络请求(UA/签名/设备指纹 peer_id/TLS 指纹)都由 .so 内部 C++ 代码发出**,与调用方语言无关

### 5.3 架构与数据流

```
┌─ 终端 UI ─────────────────┐
│ REPL / 单发命令            │  src/shell/(repl、registry、commands/*)
├─ 认证 ────────────────────┤
│ 扫码(无头浏览器开官方登录页)│  src/auth/(凭证、登录流程)
│ 或 --bduss/--stoken 引导   │
├─ 内核封装 ─────────────────┤
│ init/uninit/守卫/事件总线  │  src/kernel/init.js、events.js、errors.js
│ glue.gen.js(345 函数绑定) │  ← scripts/make-glue.mjs 从官方 asar 机械生成
├─ FFI(koffi,与官方同构)──┤
▼
libbrowserengine.so(官方,只读复用)
 └─ libkernel.so(P2SP)· netdisk_service(自动管理)
     └─ 全部流量对百度而言与官方客户端不可区分
```

登录数据流:扫码登录 → 浏览器 cookie 罐拿到 BDUSS/STOKEN → 内核请求 `uinfo`(uk/wdr/mdr)与 `report/user`(sign_key)→ 组装官方形状的 JSON 喂 `browser_engine_set_login_state` → 此后一切 API 调用都由内核完成。

### 5.4 四条设计原则

- **翻译而非发明**:函数签名、初始化序列、payload 形状全部逐字取自官方 JS(`make-glue.mjs` 可随 deb 升级一键重生成)
- **保真度优先**:不自定义 UA、不改请求参数、不多发一个轮询——任何偏离官方行为的功能都不做
- **零守护进程**:内核 init 实测 0.06 秒;已登录时不走 `global_uninit`(必崩),改用 `begin_uninit` 加 `_exit`
- **优雅降级**:终端尺寸自适应、官方 GUI 互斥有明确报错;登录必需字段缺失时直接报错,不做猜测性兜底

### 5.5 为什么能规避限流

BaiduPCS-Go 等第三方工具用自己的 app_id 走 web PCS API,服务端可识别并限速;bnd-tui 经内核发出的请求由官方 .so 的 C++ 代码生成,使用同一套握手、签名与 P2SP 通道。这是设计依据,未经抓包对比;扫码环节使用 Chromium,与官方不同。实测 SVIP 账号下 304MB 用时 25.7 秒(约 11.8MB/s),未与普通账号或第三方工具对比,不能证明规避了限速。

## 六、扫码攻坚期间新增的测试(随修复一起落地)

| 测试文件 | 用例数 | 覆盖内容 |
|---|---|---|
| `tests/qrheadless.test.js` | 9 | 终端二维码渲染器(半块字符、scale 放大、白边、模块栅距检测)、安装形态决策 `chooseLoginMode` |
| `tests/login-args.test.js` | 6 | `--bduss/--stoken` 参数解析、**completeLogin 官方序列(uinfo → report/user → set_login_state)及两类缺字段报错** |
| `tests/kernel-env.test.js` | 6 | `COMMONPARAM` 形状、私有 Xvfb 看门狗与 display 号、缺 Xvfb 报错 |
| `tests/qr.test.js` | 8 | passport 轮询状态机、cookie JSON 逐字比对、凭证组装、表单编码、cookie 域优先级、Chromium 环境 |

合计 85/85 通过(`node scripts/run-tests.js`)。这些用例使用模拟响应,不能替代真实扫码验证;此前的测试正是用虚构的 BDUSS 和签名返回值掩盖了第 7 条的问题。

测试要点:`BND_HOME` 注入必须在动态 `import()` 之前(state.js 在模块初始化时绑定主目录,静态 import 会提升导致写到真实 `~/.config`)。
