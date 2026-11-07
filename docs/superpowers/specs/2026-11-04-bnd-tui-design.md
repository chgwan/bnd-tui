# bnd-tui — 纯终端百度网盘客户端(官方内核)设计文档

- **日期:** 2026-11-04
- **状态:** draft(待用户确认)
- **技术栈:** Node.js v24 + koffi(用户选定)
- **位置:** `~/Codes/bnd-tui`

## 一、背景与动机

在无显示器的 headless RHEL 8 服务器上使用百度网盘。官方 Linux 客户端是 Electron GUI,必须有显示服务器;BaiduPCS-Go 等第三方 CLI 走 web PCS API(第三方 app_id),长期受限速/限流困扰。

本项目绕过两者:**直接加载官方客户端自带的原生内核动态库 `libbrowserengine.so`**,用与官方 GUI 完全相同的方式驱动它。传输握手、请求签名、设备指纹、TLS 指纹全部来自官方 .so 内部的 C++ 代码——对百度服务端而言,终端客户端与官方 GUI 不可区分,从根源上规避限流。

## 二、已验证的架构事实(2026-11-04 侦察结论)

以下每一条都已在测试机上实测验证,不是推测:

1. **官方客户端结构**(deb 解包于 `~/opt/baidunetdisk`):
   - `opt/baidunetdisk/libbrowserengine.so` — 内核引擎封装,导出 431 个 `browser_engine_*` C 函数(JSON-in/JSON-out)
   - `opt/baidunetdisk/libkernel.so` — P2SP 传输引擎(`create_p2sp_task` / `yunp2p_init` / `load_btsdk`),官方限速豁免通道
   - `opt/baidunetdisk/netdisk_service` — 本地 HTTPS 助手(127.0.0.1:10000),由内核自动启停,无需我们管理
   - 依赖库在 `deps/usr/lib64`,需设置 `LD_LIBRARY_PATH`
2. **官方 GUI 的 JS 主进程本身就是用 koffi FFI 调 `libbrowserengine.so`**(`koffi.load(path)` + `.func()` 声明)。我们的做法与官方内部实现同构。
3. **可行性已实测**:用 Python ctypes 无 GUI 加载该 .so 并调用 `browser_engine_get_version()` 成功返回 `1.3.7.20`。
4. 官方 JS(`resources/core.asar` 内 `main.js`,已解包)含**全部 324 个 koffi 函数签名声明、全部调用现场、错误码表、init 时序**——glue 层是翻译而非发明。
5. 初始化:`browser_engine_global_init(内部日志回调指针, 通用事件回调指针, 路径字符串)`,没有复杂结构体。
6. 登录:`browser_engine_set_login_state(JSON)`,官方现场实测的 JSON 结构:

   ```json
   {
     "sign_key": "<来自 get_login_auth_param,待实现时确认>",
     "bduss": "<BDUSS>", "stoken": "<STOKEN>", "pass_stoken": "<PASS_STOKEN>",
     "vip_flag": 0, "vip_level": 0, "uk": "<uk>", "wdr": "<wdr>", "mdr": "<mdr>",
     "cookies": ["BDUSS=<...>", "STOKEN=<...>"]
   }
   ```

7. 异步结果通过回调分发:`browserEngineCommonEventCallback`(事件名 + JSON)、`browserEngineInternalLogCallback`(日志)。

## 三、目标

- **登录**:扫码登录(终端渲染 ASCII 二维码)+ 账号密码登录(含验证码兜底);登录态由内核持久化,重启免登
- **文件浏览**:`ls` / `cd` / `tree` / 按分类列出(文档/图片/视频等)
- **传输**:下载/上传/断点续传(内核自带),走官方 P2SP 引擎,P2P 加速可开关(`P2P_MODE_TYPE_SPEEDUP=2 / DISABLE_UPLOAD=0`)
- **任务管理**:实时进度面板、暂停/恢复/删除/置顶、历史记录
- **分享**:`sharelink_query_link_info` / `sharelink_verify_pwd` / `sharelink_transfer`(转存他人分享)
- **回收站/搜索**:trash 列表/恢复/清空;文件名/分类/全文搜索
- **配置**:下载目录、并发数、限速、P2P 开关,`config get/set` 持久化
- 交互形态对齐 BaiduPCS-Go:交互式 shell(命令补全、历史、`bnd> ` 提示符)+ `bnd <cmd>` 单发模式

## 四、非目标

- 不做 GUI、视频播放、相册自动备份、IM、企业网盘、同步盘
- 不跨平台:只针对本机 Linux x64 + 当前这份官方 deb
- 不重写传输协议、不逆向加密算法、不修改官方安装目录内任何文件
- 不做官方客户端自动更新(升级 deb 后需重跑 glue 提取,见风险)

## 五、反目标(即便技术上可行也不做)

- 任何使流量指纹偏离官方客户端的行为:不改 UA、不改请求参数、不加额外轮询
- 批量/高频异常调用模式(风控红线)

## 六、架构与模块划分

```
bnd-tui/
├── package.json              # 唯一依赖: koffi
├── bin/bnd.js                # 入口: 单发命令 或 交互 shell
├── src/
│   ├── kernel/
│   │   ├── loader.js         # koffi.load + 全套 .func/.proto 声明(译自官方 main.js)
│   │   ├── init.js           # global_init / 回调注册 / app 参数设置 / uninit
│   │   ├── errors.js         # 错误码表(SERVER_ERR_* / CLIENT_ERR_* / BrowserCode)
│   │   └── events.js         # CommonEventCallback 的事件分发总线
│   ├── auth/
│   │   ├── qr.js             # 扫码登录: passport API + 终端二维码渲染 + 轮询
│   │   ├── password.js       # 密码登录: passport API + RSA + 验证码
│   │   └── state.js          # 登录态恢复(load_local_login_info)
│   ├── shell/
│   │   ├── repl.js           # 交互 shell(readline,补全/历史)
│   │   └── commands/         # 每命令一文件: ls/cd/download/upload/tasks/...
│   └── util/format.js        # 大小/速度/进度条
└── docs/
    ├── superpowers/specs/    # 本文档
    └── recon/                # 侦察产物存档: 内核导出表、koffi 签名、关键调用现场摘录
```

## 七、关键技术方案

### 7.1 内核 glue:翻译而非发明

- 官方 `main.js` 已解包(当前在 `/tmp/bnd-recon/data/core/main.js`,落地时把关键片段存档进 `docs/recon/`,并写一个 `scripts/make-glue.mjs` 提取脚本,用正则从官方 asar 重新生成 `loader.js` 声明——这是应对 deb 升级的长期手段)
- `loader.js`:逐字翻译 324 个 `.func("browser_engine_…", ret, [args])` 声明;`koffi.proto` 回调类型同理
- `init.js`:照抄官方 init 时序 —— 设置 app 参数(`browser_engine_set_param_by_id` 的调用清单在 main.js init 模块)→ `global_init(logCb, eventCb, workdir)` → `get_version()` 校验
- `errors.js`:翻译官方错误码常量表(共约 60 项)

### 7.2 登录

- **扫码**:调 passport 二维码接口获取 qrcode_url + lp(思路参照 BaiduPCS-Go 的 qrlogin,但 UA 用官方值)→ 终端渲染 ASCII 二维码 → 轮询签收状态 → 拿到 BDUSS/STOKEN → 调 `get_login_auth_param` 补 sign_key → `set_login_state(JSON)`
- **密码**:passport login API,密码按官方前端算法 RSA 加密(算法可参照 BaiduPCS-Go 实现),需要验证码/短信时在终端交互提示
- **恢复**:启动时先 `browser_engine_load_local_login_info()`,失败才要求登录
- 实现顺序上,M1 先打通扫码(依赖面最小),密码登录放 M3

### 7.3 传输与任务

- 下载:`browser_engine_download_cloud_file(JSON, bool)`(JSON 字段结构在官方调用现场已定位,实现时照抄);上传:`browser_engine_upload_general_files`
- 任务流:`enable_auto_get_task_items(true)` + `set_task_callback` 收进度;`get_task_items` 拉全量;`pause_task` / `delete_task` / `top_task` 控制
- 进度渲染:任务面板用 ANSI 单行刷新(自写,不引依赖)

## 八、里程碑

| 里程碑 | 内容 | 预估 |
|---|---|---|
| M0 | loader + init + `bnd version` 跑通;npm 装 koffi 验证 | 0.5 天 |
| M1 | 扫码登录 + 登录态恢复 + `ls`/`cd` | 1 天 |
| M2 | 下载/上传 + 任务面板(暂停/恢复/删除) | 1–2 天 |
| M3 | 密码登录 + 分享转存 + 回收站 + 搜索 + config | 1 天 |
| M4 | 打磨:补全、历史、异常路径、README | 0.5 天 |

## 九、风险与对策

| 风险 | 对策 |
|---|---|
| `sign_key` 获取细节未完全确认 | M1 第一件事验证 `get_login_auth_param`;若扫码流程拿不到,现场调试官方 JS 的登录链路补齐 |
| 与官方 GUI 双开互斥(`baidu_netdisk_service_mutex`) | 启动时检测官方进程,默认警告并要求先退出 GUI;提供一个 `--coexist` 试验开关 |
| deb 升级改变 ABI/签名 | `scripts/make-glue.mjs` 可从新版 asar 一键重生成声明;版本不匹配时 `get_version` 校验报警 |
| koffi 与 Node 24 兼容性 | koffi 当前版本支持 Node 24;M0 首步验证,失败则锁旧版 Node |
| 账号风控 | 流量与官方一致的前提下,默认行为保守:无自动重试风暴、无高频轮询 |
| `~/.config/baidunetdisk` 状态被双进程写坏 | 默认独占运行(见上);不做状态目录隔离(会丢失登录态,得不偿失) |

## 十、决策记录

- 技术栈 **Node.js + koffi**(2026-11-04 用户选定;理由:官方 glue 同构可逐字翻译,行为序列保真度最高)
- 项目名 `bnd-tui`,位于 `~/Codes/bnd-tui`
- 输出中文,命令与参数英文(BaiduPCS-Go 惯例)
- 不初始化 git、不提交,除非用户明确要求

## 十一、留给实现者的自由裁量

- `make-glue.mjs` 的具体正则与输出组织
- 终端二维码渲染:引 `qrcode-terminal`(唯一候选第三方依赖)或自写 UTF-8 半块渲染
- 命令别名与 BaiduPCS-Go 的映射表细节
- 任务面板的具体布局
