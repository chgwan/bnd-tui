// 内核生命周期:init(带 GUI 守卫)/ uninit / 状态查询。
// global_init 语义已在 docs/recon/init_experiment.py 验证:
//   global_init(InternalLogCb*, CommonEventCb*, workdir) → 0 成功,~60ms;
//   global_uninit(ExitFinishedCb*) → 干净退出。
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import koffi from 'koffi';
import { loadEngine } from './loader.js';
import { clearStaleShm } from './stale-shm.js';
import { declareAll, PROTOS } from './glue.gen.js';
import { initEventBus } from './events.js';
import { describeCode } from './errors.js';

let kernel = null; // { api, events, lib, exitFinished }
let exitWaiter = null; // { resolve, timer }

const BEOPT_COMMONPARAM = 0;
const APP_VERSION = '8.9.7'; // 官方 package.json 的 version,升级 deb 后同步

// 逐字对应官方 main.js 的 COMMONPARAM:不设置时内核请求的 channel 为空、version 为默认值
export function buildCommonConfig({ release = os.release(), arch = os.arch() } = {}) {
  const platform = arch === 'arm64' ? 'Linux-aarch64' : 'Linux';
  const dash = release.indexOf('-');
  const osVersion = dash > 1 ? release.slice(0, dash) : release;
  return {
    netdisk_root: 'https://pan.baidu.com/',
    ua: `netdisk;${APP_VERSION};PC;PC-${platform};${osVersion};UniBaiduYunGuanJia`,
    channel: `${platform}_${osVersion}_Uniyunguanjia_netdisk_00000000`,
    app_version: APP_VERSION,
    client_type: '35',
  };
}

const OFFICIAL_BASENAMES = new Set(['baidunetdisk', 'netdisk_service']);

function sameUser(psUser, user) {
  if (psUser === user) return true;
  // ps 默认把用户名截到 8 字符并加 '+':alice.wo+ vs alice.wonder
  if (psUser.endsWith('+')) {
    const base = psUser.slice(0, -1);
    return user.length > base.length && user.startsWith(base);
  }
  return false;
}

export function parsePs(psOutput, user) {
  const procs = [];
  for (const line of String(psOutput).split('\n').slice(1)) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const [, pidS, ppidS, psUser, stat, cmd] = m;
    if (!sameUser(psUser, user)) continue;
    if (stat.includes('Z')) continue; // 僵尸进程不算存活
    const base = cmd.split(/\s+/)[0]?.split('/').pop() ?? '';
    // 内核启动的服务会比启动者活得久:父进程已退出(PPID 1)的孤儿无人使用,不算占用
    if (base === 'netdisk_service' && ppidS === '1') continue;
    if (OFFICIAL_BASENAMES.has(base)) procs.push({ pid: Number(pidS), cmd });
  }
  return procs;
}

export function detectOfficialProcesses() {
  const res = spawnSync('ps', ['-eo', 'pid,ppid,user:32,stat,cmd'], { encoding: 'utf8' });
  if (res.status !== 0) return [];
  return parsePs(res.stdout, os.userInfo().username);
}

export function checkExclusive({ coexist = false, psOutput, user } = {}) {
  const procs = psOutput === undefined ? detectOfficialProcesses() : parsePs(psOutput, user);
  if (procs.length > 0 && !coexist) {
    throw new Error(
      `检测到官方客户端或另一个 bnd 正在运行(PID ${procs.map((p) => p.pid).join(', ')})。` +
        'netdisk_service 为单例、后启动者会接管,可能打断正在进行的操作。\n' +
        '请先关闭对方,或加 --coexist 强制共存后重试。',
    );
  }
}

export function isKernelUp() {
  return kernel !== null;
}

export function initKernel({ coexist = false, enginePath } = {}) {
  if (kernel) throw new Error('内核已初始化,不可重复 init');
  checkExclusive({ coexist });
  if (!coexist) clearStaleShm();
  // 内核多个线程并发调 Xlib(Electron 启动时会做这一步):不初始化时 XOpenDisplay 偶发返回
  // NULL,内核不检查就段错误。必须早于任何 Xlib 调用
  koffi.load('libX11.so.6').func('XInitThreads', 'int', [])();
  const { lib } = loadEngine({ enginePath });
  const api = declareAll(lib);
  const events = initEventBus();

  const onExitFinished = (ok) => {
    if (exitWaiter) {
      clearTimeout(exitWaiter.timer);
      const { resolve } = exitWaiter;
      exitWaiter = null;
      kernel = null;
      resolve(Boolean(ok));
    }
  };
  const exitFinished = koffi.register(onExitFinished, koffi.pointer(PROTOS.ExitFinished));

  const rc = api.browser_engine_global_init(
    events.pointers.internalLog,
    events.pointers.commonEvent,
    os.homedir(),
  );
  if (rc !== 0) throw new Error(`内核初始化失败:${describeCode(rc)}`);

  const configRc = api.browser_engine_set_config(BEOPT_COMMONPARAM, JSON.stringify(buildCommonConfig()));
  if (configRc !== 0) throw new Error(`内核配置失败:${describeCode(configRc)}`);

  kernel = { api, events, lib, exitFinished, loggedIn: false };
  return kernel;
}

let needsHardExit = false;

// 已登录时内核线程不会停下,exit() 的静态析构与其竞争而段错误,须用 _exit 跳过析构
export function exitProcess(code) {
  if (needsHardExit) koffi.load('libc.so.6').func('_exit', 'void', ['int'])(code);
  process.exit(code);
}

export function noteLoggedIn() {
  if (kernel) kernel.loggedIn = true;
}

export function uninitKernel() {
  return new Promise((resolve) => {
    if (!kernel) return resolve(false);
    const { api, exitFinished, loggedIn } = kernel;
    if (loggedIn) {
      // 已登录时 global_uninit 必段错误(实测,线程跳到未映射地址);
      // 走官方的退出超时路径:begin_uninit 后由进程退出收尾
      api.browser_engine_electron_begin_uninit();
      kernel = null;
      needsHardExit = true;
      return resolve(true);
    }
    let settled = false;
    exitWaiter = {
      resolve: (ok) => {
        if (!settled) { settled = true; resolve(ok); }
      },
      timer: setTimeout(() => {
        if (!settled) { settled = true; kernel = null; resolve(false); }
      }, 5000),
    };
    api.browser_engine_global_uninit(exitFinished);
  });
}

export function getKernel() {
  return kernel;
}
