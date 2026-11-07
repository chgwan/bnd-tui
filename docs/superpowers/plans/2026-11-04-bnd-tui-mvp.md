# bnd-tui MVP 实施计划(M0–M2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 纯终端百度网盘客户端:扫码登录、`ls`/`cd`、下载/上传、任务面板,全部经官方内核 `libbrowserengine.so`。

**Architecture:** Node 进程用 koffi 加载官方 `libbrowserengine.so`(与官方 GUI 内部做法同构);函数声明由 `scripts/make-glue.mjs` 从官方 asar 机械提取生成;命令层(REPL + 单发)在内核封装之上。无守护进程——每次调用完整 init(实测 0.06s)/uninit。

**Tech Stack:** Node v24(ESM)、koffi、qrcode-terminal;测试用内置 `node --test`。

**Spec:** `docs/superpowers/specs/2026-11-04-bnd-tui-design.md`(侦察事实、风险对策、决策记录都在 spec;实现者须先读)

## Global Constraints

- Node v24:`~/.nvm/versions/node/v24.14.0/bin/node`;`package.json` 设 `"type":"module"`
- 运行时依赖只允许:`koffi`、`qrcode-terminal`
- 官方安装目录 `~/opt/baidunetdisk` **只读,永不修改**;内核引擎路径 `~/opt/baidunetdisk/opt/baidunetdisk/libbrowserengine.so`;`LD_LIBRARY_PATH` 必须含 `~/opt/baidunetdisk/deps/usr/lib64` 且**必须在进程启动前设置**(glibc 缓存搜索路径,进程内改无效 → bin 自举 re-exec)
- 内核共享状态目录为真实 `~/.config/baidunetdisk`(与 GUI 同);`netdisk_service` 是单例、后来者接管 —— 默认检测到官方进程在跑就拒绝启动引擎,`--coexist` 覆盖
- **不 git init、不 add、不 commit**(用户规则 + spec §10);任务以验证通过为终点
- 单元测试 `node --test tests/`;涉及真实内核/账号的步骤标注 `[LIVE]`,通过 CLI 手动验证,不进单测
- 输出中文;命令与参数英文
- 已钉死的事实(不得偏离):
  - `BrowserCode.BROWSER_OK = 0`(其余值见 docs/recon,koffi_sigs.txt 同目录)
  - `browser_engine_global_init(InternalLogCb*, CommonEventCb*, string workdir)` → uint32
  - 回调原型:`browserEngineInternalLogCallback: void(uint32, string)`;`browserEngineCommonEventCallback: void(int32 eventId, string json, int32 extra)`;`browserEngineExitFinishedCallback: void(bool)`
  - headless init 实测 rc=0 / 0.06s / 干净 uninit(docs/recon/init_run2.log)
  - `browser_engine_set_login_state(string json)`,JSON 形状(字段名逐字):

    ```json
    {"sign_key":"","bduss":"","stoken":"","pass_stoken":"","vip_flag":0,"vip_level":0,"uk":"","wdr":"","mdr":"","cookies":["BDUSS=...","STOKEN=..."]}
    ```

  - `browser_engine_load_local_login_info` 是死代码(官方从未调用),登录恢复 = 自持久化凭证重新喂 `set_login_state`

## Review Focus

1. **GUI 双开**:引擎启动时官方进程存活 → 中文明确报错并退出(除非 `--coexist`),不静默接管。测试:Task 4 用注入的进程列表测守卫逻辑。
2. **回调生命周期**:koffi 注册的回调必须被模块级引用持有到进程退出,否则 GC 后内核回调进已释放内存 → 崩溃。测试:Task 3 断言注册表在 init 后非空且进程存续期间可枚举。
3. **中文/空格/emoji 文件名**经 koffi 字符串编解码往返。测试:Task 8 用含 `"文件 名🎉.mp4"` 的 fixture 测路径解析与表格渲染。
4. **脏退出**:传输中 Ctrl-C 必须走 `global_uninit` 并等 exit-finished(超时 5s 强退)。测试:Task 4 单测信号处理器分支;Task 10 `[LIVE]` 验证。
5. **错误码透出**:任何内核调用返回非 0 → `describeCode` 中文消息,不允许裸数字。测试:Task 3 单测未知码回退;Task 8/9 单测以假 rc 驱动输出。

---

### Task 1: 项目骨架 + 环境自举 + koffi 冒烟

**Files:**
- Create: `package.json`、`bin/bnd.js`、`src/kernel/loader.js`、`tests/loader.test.js`

**Interfaces:**
- Produces: `loadEngine({ enginePath } = {}) -> { lib, api }`,其中 `api.get_version()` 已绑定;`bin/bnd.js` 支持 `node bin/bnd.js version`

- [ ] **Step 1: 初始化项目**

`npm init -y` 后编辑 `package.json`:`"type":"module"`, `"bin":{"bnd":"bin/bnd.js"}`,安装 `koffi`。运行 `npm ls koffi` 确认无错。

- [ ] **Step 2: 写 loader 与自举入口**

`src/kernel/loader.js`:默认路径 `~/opt/baidunetdisk/opt/baidunetdisk/libbrowserengine.so`;文件不存在时 throw 中文错误;`koffi.load(path)` 后绑定 `get_version`(`.func('browser_engine_get_version','string',[])`)。
`bin/bnd.js`:若 `process.env.BND_REEXEC !== '1'` 且 `LD_LIBRARY_PATH` 不含 deps 目录 → `child_process.spawn(process.execPath, argv, { env: {...process.env, LD_LIBRARY_PATH: deps+':'+old, BND_REEXEC:'1'}, stdio:'inherit' })` 并以子进程退出码退出;否则进入命令分发(本任务只实现 `version`)。

- [ ] **Step 3: 验证**

Run: `node bin/bnd.js version`
Expected: 打印 `1.3.7.20`(与 docs/recon/init_run2.log 一致)。
`tests/loader.test.js`:引擎文件缺失时(注入假路径)抛错含"libbrowserengine.so";真实引擎存在则 `api.get_version()` 匹配 `/^\d+\.\d+/`。

### Task 2: make-glue 提取脚本 + glue.gen.js

**Files:**
- Create: `scripts/make-glue.mjs`、`src/kernel/glue.gen.js`(生成物)、`tests/make-glue.test.js`

**Interfaces:**
- Produces: `glue.gen.js` 导出 `PROTOS`(回调原型,如 `PROTOS.CommonEvent`)与 `declareAll(lib) -> api`(全部 browser_engine_* 绑定)

- [ ] **Step 1: 写失败测试**

断言(对真实 core.asar 跑):生成文本含 `"browser_engine_global_init"` 且其参数表含 `"string"`;含 `"browser_engine_set_login_state"`、`"browser_engine_fetch_file_list"`、`"browser_engine_download_cloud_file"`;`declareAll` 绑定数 ≥ 300。

- [ ] **Step 2: 跑测试确认失败**(glue.gen.js 不存在)

Run: `node --test tests/make-glue.test.js` — Expected: FAIL

- [ ] **Step 3: 实现 make-glue.mjs**

asar 头解析:`readUInt32LE ×4` → 第 4 个值 = JSON 长度,JSON 偏移 16,数据基址 `8 + 第2个值`(参照 docs/recon/asar_tool.py,用 Node 重写);从官方 `resources/core.asar` 提取 `main.js` 文本;正则提取 `.func("browser_engine_…","ret",[args])` 与 `.proto("…")`(koffi 类型词法:`"int32"`、`a.a.inout("int64*")`、`a.a.pointer(X)` → 输出时映射为 koffi 等价:`koffi.inout(koffi.pointer(koffi.types.int64_t))` 等;`a.a` 就是 `koffi`);emit `glue.gen.js`。运行 `node scripts/make-glue.mjs` 生成。

- [ ] **Step 4: 跑测试确认通过 + 真机冒烟**

Run: `node --test tests/make-glue.test.js` — Expected: PASS
Run: `node -e "import('./src/kernel/glue.gen.js').then(m=>{const koffi=require('koffi');const lib=koffi.load(process.env.HOME+'/opt/baidunetdisk/opt/baidunetdisk/libbrowserengine.so');const api=m.declareAll(lib);console.log(typeof api.browser_engine_fetch_file_list)})"` — Expected: `function`

### Task 3: 错误码表 + 事件总线(回调注册与持有)

**Files:**
- Create: `src/kernel/errors.js`、`src/kernel/events.js`、`tests/events.test.js`、`tests/errors.test.js`

**Interfaces:**
- Produces: `describeCode(code) -> string`(中文);`BrowserCode.OK=0`;`initEventBus(api, { onLog }) -> { dispatch, onEvent, callbackRefs }`;`onEvent(matcher, fn)`(matcher 为 eventId 数字或 '*')

- [ ] **Step 1: 写失败测试**

`errors.test.js`:`describeCode(0)` 含 "成功";`describeCode(99999)` 返回含 "99999" 的回退串。
`events.test.js`:构造 `dispatch(58, '{"status":"0"}', 37)` → 注册的 `onEvent(58, fn)` 收到已解析对象且 `extra===37`;`callbackRefs.size >= 2`(两个回调都被持有)。

- [ ] **Step 2: 跑测试确认失败** — Run: `node --test tests/events.test.js tests/errors.test.js` — Expected: FAIL

- [ ] **Step 3: 实现**

`errors.js`:BrowserCode 表从 main.js 实测值抄写(`BROWSER_OK:0, BROWSER_ERROR:1, BROWSER_FALSE:2, BROWSER_DATABASE_ERROR:3, BROWSER_DATABASE_EMPTY:4, BROWSER_FAILED_INIT:5, BROWSER_OUT_OF_MEMORY:6, BROWSER_PARAMETER_INVALID:7, BROWSER_NOT_IMPLIMENT:8`,其余从 docs/recon/koffi_sigs.txt 上下文补);SERVER_ERR_*/CLIENT_ERR_* 常用项(任务/传输错误)一并收录,每项配中文短语。
`events.js`:`koffi.register` 两个回调(用 `PROTOS.InternalLog` / `PROTOS.CommonEvent`),**返回的指针存入模块级 `callbackRefs`(Map,永不清除)**;`dispatch` 解析 JSON(解析失败给原文),按 eventId 分发;日志回调默认转发 `onLog`(level ≥ 警告时打印)。

- [ ] **Step 4: 跑测试确认通过** — Run: `node --test tests/events.test.js tests/errors.test.js` — Expected: PASS

### Task 4: 内核 init/uninit + GUI 守卫 + 信号处理

**Files:**
- Create: `src/kernel/init.js`、`tests/init-guard.test.js`;Modify: `bin/bnd.js`(所有命令经 init)

**Interfaces:**
- Consumes: Task 1 `loadEngine`、Task 2 `declareAll`、Task 3 `initEventBus`
- Produces: `initKernel({ coexist = false } = {}) -> { api, events }`(失败 throw 中文 Error);`uninitKernel() -> Promise<boolean>`(等 exit-finished,5s 超时);`isKernelUp() -> boolean`;全局选项 `--coexist`

- [ ] **Step 1: 写失败测试**

守卫:注入 `procs = ['baidunetdisk --no-sandbox']` 且 `coexist:false` → throw 含 "官方客户端正在运行";`coexist:true` 不 throw;`procs=[]` 不 throw;僵尸(defunct)不计入。

- [ ] **Step 2: 跑测试确认失败** — Run: `node --test tests/init-guard.test.js` — Expected: FAIL

- [ ] **Step 3: 实现**

进程检测:`ps -eo pid,stat,cmd` 过滤本用户 `baidunetdisk|netdisk_service`,剔除 stat 含 `Z`。
init 序列照抄官方 + 实验脚本(docs/recon/init_experiment.py):`loadEngine` → `declareAll` → `initEventBus` → `global_init(internalLogPtr, commonEventPtr, os.homedir())` → rc≠0 throw `describeCode(rc)`;rc==0 后 `api.browser_engine_get_version()` 校验。
`uninitKernel`:`global_uninit(exitFinishedPtr)`,Promise 由 exit-finished 回调 resolve。
`bin/bnd.js`:命令执行前 `initKernel`,finally `await uninitKernel()`;注册 SIGINT/SIGTERM:置标志 → 若内核已起 → `uninitKernel()` 后 `process.exit(130)`,未起则直接退出。

- [ ] **Step 4: 跑测试确认通过** — Run: `node --test tests/init-guard.test.js` — Expected: PASS

- [ ] **Step 5: [LIVE] 端到端验证**

Run: `node bin/bnd.js version` — Expected: `1.3.7.20`,进程 1s 内退出,无残留 `netdisk_service`(用 `pgrep -af netdisk_service` 前后对比;注意与 GUI 的实例区分,建议测试前关掉 VNC 里的 GUI,测完再开)。

### Task 5: 配置存储 + 格式化工具

**Files:**
- Create: `src/config.js`、`src/util/format.js`、`tests/format.test.js`、`tests/config.test.js`

**Interfaces:**
- Produces: `loadConfig() -> { download_dir, max_parallel, p2p_mode }`(默认 `~/Downloads/bnd`、3、2=官方 SPEEDUP;文件 `~/.config/bnd-tui/config.json`,权限 0600);`saveConfig(patch)`;`formatSize(bytes) -> "1.5 MB"`、`formatSpeed(bps)`、`renderBar(cur, total, width) -> "[####----] 50%"`

- [ ] **Step 1: 写失败测试**

`formatSize(0)`→"0 B"、`formatSize(1536)`→"1.5 KB";`renderBar(5,10,10)` 首尾为 `[`/`]` 且含 "50%";config:写临时 HOME → 读回一致;权限 0600;未知 key 忽略。

- [ ] **Step 2–4: 红 → 实现 → 绿**

实现为一目了然的纯函数;config 的 HOME 用 `process.env.BND_HOME ?? os.homedir()` 便于测试注入。
Run: `node --test tests/format.test.js tests/config.test.js` — Expected 最终 PASS

### Task 6: 登录态封装(内核侧)

**Files:**
- Create: `src/auth/state.js`、`tests/auth-state.test.js`

**Interfaces:**
- Consumes: Task 4 `initKernel` 的 `api`
- Produces: `normalizeCreds(raw) -> credsObj`(字段与顺序照 Global Constraints 的 JSON 形状;`wdr/mdr/pass_stoken` 缺省空串,`cookies` 由 bduss/stoken 合成);`applyLogin(api, creds) -> { ok, code, msg }`;`saveCreds/loadCreds`(文件 `~/.config/bnd-tui/credentials.json`,0600);`restoreLogin(api) -> boolean`;`logout(api)`(clear_login_state + 删凭证文件)

- [ ] **Step 1: 写失败测试**

normalize:输入只有 `{BDUSS,STOKEN,uk}` → 输出含全部 11 个键、`cookies` 两元素、vip 数字 0;JSON.stringify 后 `sign_key` 在首位。
applyLogin:假 api 记录入参,rc=0 → ok:true;rc=7 → ok:false 且 msg 含 "参数"(经 describeCode)。

- [ ] **Step 2–4: 红 → 实现 → 绿** — Run: `node --test tests/auth-state.test.js` — Expected 最终 PASS

### Task 7: 扫码登录 `[LIVE 为主]`

**Files:**
- Create: `src/auth/qr.js`;Modify: `bin/bnd.js` 增加 `login`、`logout`、`whoami`

**Interfaces:**
- Consumes: Task 6 全部
- Produces: `qrLogin(api, { render } = {}) -> credsObj`(render 默认 `qrcode-terminal` 到 stderr);`whoami(api) -> Promise<{uk, name} | null>`(监听登录态事件或 `browser_engine_get_xep_value_by_key` 取用户信息,实现时从 main.js 对应调用现场确认取法)

- [ ] **Step 1: 侦察钉参数(在 /tmp/bnd-recon 或 docs/recon 的 main.js 里)**

1. `get_login_auth_param(e, n, out_errno*)` 的两个入参含义(搜官方调用现场 `get_login_auth_param(`,记录传值);2. 官方扫码流程用的 passport 端点与 UA(main.js 搜 `qrcode|qrconnect|passportapi`,若 JS 无则用 passport 开放接口:`passport.baidu.com/device/...` 或 BaiduPCS-Go 同款流程,UA 取官方 app UA 串)。结论写进本文件勾选框下方。

- [ ] **Step 2: 实现 login 命令**

流程:取 QR(渲染到终端)→ 轮询(2s 间隔,状态机 pending/scanned/success/expired,终端单行刷新)→ success 拿 BDUSS/STOKEN(及可得字段)→ `get_login_auth_param` 补 sign_key(拿不到先置空串试)→ `normalizeCreds` → `applyLogin` → ok 后 `saveCreds`;失败路径:JSON 缺 uk 时,`applyLogin` 后经 `whoami` 事件回收 uk 并补存。

- [ ] **Step 3: [LIVE] 验证**

`node bin/bnd.js login` → 终端出二维码,用手机百度网盘 App 扫码确认 → 输出"登录成功 uk=…";`node bin/bnd.js whoami` 再起一进程仍能显示用户(restoreLogin 路径);`logout` 后 `whoami` 为空。GUI 此时应关闭,完成后用户自行重开。

### Task 8: `ls` / `cd` + 远程路径上下文

**Files:**
- Create: `src/shell/context.js`、`src/shell/commands/ls.js`、`src/shell/commands/cd.js`、`tests/context.test.js`、`tests/ls-render.test.js`

**Interfaces:**
- Consumes: `initKernel`、`restoreLogin`
- Produces: `makeCtx() -> ctx`(含 `cwd:'/'`、config);`resolveRemote(cwd, arg) -> '/abs/path'`(支持 `..`、`.`、`/`、相对路径、尾部 `/` 归一);命令统一签名 `run(ctx, args) -> Promise<void>`;`renderFileTable(files) -> string`(中文表头:名称/大小/修改时间,目录后加 `/`,按目录优先排序)

- [ ] **Step 1: 侦察钉参数**

官方 `fetch_file_list(` 调用现场(main.js)确认 8 参含义(推测:dirPath、orderBy、page、pageSize、orderFlag、touchCurPath、out_total*、callback),连同官方 pageSize(常为 1000)与回调 8 参中 JSON 载荷位置记录于此。

- [ ] **Step 2: 写失败测试**

`resolveRemote('/a/b', '..')`→`/a`;`('/a', 'b/c/')`→`/a/b/c`。
`renderFileTable` fixture 含 `"文件 名🎉.mp4"`、目录项 → 表格行数/排序/UTF-8 不转义。
分页:假 api 第一页返回 total=1500、两页后合并(迭代器单测,假回调触发)。

- [ ] **Step 3–5: 红 → 实现 → 绿;[LIVE] `node bin/bnd.js ls /`**

Expected:登录后列出根目录,中文名正常;`ls` 大目录(>1000 项)自动翻页不丢项。

### Task 9: `download` / `upload`

**Files:**
- Create: `src/shell/commands/download.js`、`src/shell/commands/upload.js`、`tests/transfer-json.test.js`

**Interfaces:**
- Consumes: ctx、config.download_dir、Task 10 的任务显示(可选监听)
- Produces: `buildDownloadPayload(paths, localDir, config) -> string`(JSON,形状抄官方调用现场);`buildUploadPayload(localPaths, remoteDir, config) -> string`

- [ ] **Step 1: 侦察钉参数**

main.js 搜 `browser_engine_download_cloud_file(` 与 `upload_general_files(` 的实参构造(JSON 字段名逐字记录);错误路径:`CLIENT_ERR_LOCAL_DIR_NOT_FOUND` 等映射进 errors.js 已有表。

- [ ] **Step 2: 写失败测试**

payload builder:输入 fixture → 深比较字段(含 max_parallel 与 p2p_mode 来自 config);本地目录不存在 → 抛中文错误含 "目录不存在"。

- [ ] **Step 3–4: 红 → 实现 → 绿;[LIVE]**

用户指定网盘内一个小文件:`node bin/bnd.js download <远程路径>` → 落到 download_dir,md5/大小与网盘一致;`node bin/bnd.js upload <本地文件>` → VNC 的 GUI(重开后)可见新文件。

### Task 10: `tasks` 任务面板 + 控制

**Files:**
- Create: `src/shell/commands/tasks.js`、`tests/tasks-render.test.js`

**Interfaces:**
- Consumes: `enable_auto_get_task_items(true)`、`get_task_items`、`set_task_callback`、`pause_task`/`delete_task`/`top_task`
- Produces: `renderTaskPanel(items) -> string`(单帧多行:ID/文件名/方向/进度条(format.js)/速度/状态中文);`tasks` 命令带 `--watch`(500ms ANSI 刷新)、`pause <id>`、`resume <id>`、`delete <id>`、`top <id>` 子动作

- [ ] **Step 1: 侦察钉参数**

`get_task_items(` 与 `set_task_callback` 官方现场(任务类型字符串枚举、回调签名、item JSON 字段名)记录于此。

- [ ] **Step 2: 写失败测试**

renderTaskPanel fixture(下载中/暂停/完成三态,含长文件名截断)→ 行数与状态中文正确;进度 0 时不除零。

- [ ] **Step 3–4: 红 → 实现 → 绿;[LIVE]**

`tasks --watch` 观察 Task 9 的传输:进度推进、`pause`/`resume` 生效、完成后退出面板;Ctrl-C 触发干净 uninit(Review Focus #4)。

### Task 11: REPL + 命令注册表 + 使用说明

**Files:**
- Create: `src/shell/repl.js`、`src/shell/registry.js`;Modify: `bin/bnd.js`(无参进入 REPL);Create: `README.md`

**Interfaces:**
- Consumes: 全部命令
- Produces: `registerCommand(name, { run, desc, complete? })`;`startRepl(ctx)`(`bnd> ` 提示符、历史、Tab 补全命令名);单发与 REPL 共用同一注册表;`bnd help` 列命令

- [ ] **Step 1: 写失败测试**

registry:重复注册 throw;`help` 输出含全部已注册命令名。dispatch:未知命令 → 中文 "未知命令,help 查看"。

- [ ] **Step 2–4: 红 → 实现 → 绿;[LIVE]**

`node bin/bnd.js` 进入 REPL:`ls`、`cd 目录`、`download …`、`tasks`、`exit` 连贯走通(内核只 init 一次)。

- [ ] **Step 5: README**

简短使用说明(安装、login、常用命令、`--coexist`、与 GUI 互斥说明),链接 spec。

---

## 明确不做(本计划)

密码登录、分享转存、回收站、搜索、tree、config 命令化 —— M3 计划另写(spec §八 M3/M4)。
