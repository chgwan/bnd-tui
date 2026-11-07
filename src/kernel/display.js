// 内核的剪贴板监控线程在 set_login_state 后调用 XOpenDisplay,且不检查 NULL:
// 无 DISPLAY 时 XInternAtom(NULL) 直接段错误。无桌面环境下给内核一个私有 Xvfb
// (不借用用户的 VNC,以免内核监听真实剪贴板)。
//
// Xvfb 的生命周期必须只绑定 bnd 进程,以下做法均实测崩溃:
// - -terminate:任何短连接(Chromium、内核自身)断开都会让 Xvfb 退出,XOpenDisplay 随之失败
// - 退出时杀 Xvfb:断开内核的 X 连接,Xlib 在内核线程里调 exit(),与主线程退出竞争
// 因此由 sh 看门狗持有 Xvfb:bnd 无论如何退出,stdin 管道都会关闭,此后才杀 Xvfb。
// 按 PID 分配 display 号,避免退出中的旧实例删掉新实例的 socket。
import { spawn } from 'node:child_process';

const WATCHDOG = `command -v Xvfb >/dev/null || exit 127
Xvfb "$@" &
x=$!
exec 3>&-
cat >/dev/null
kill $x`;

let watchdog = null; // 持有引用:stdin 管道被回收会提前杀掉 Xvfb

function readDisplayNumber(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Xvfb 启动超时')), timeoutMs);
    const done = (fn, value) => { clearTimeout(timer); fn(value); };
    let buf = '';
    child.stdio[3].on('data', (chunk) => {
      buf += chunk;
      if (buf.includes('\n')) done(resolve, buf.trim());
    });
    child.on('error', (e) => done(reject, e));
    child.on('exit', (code) => done(reject, new Error(
      code === 127 ? '未找到 Xvfb:内核需要 X display。请安装 Xvfb,或设置 DISPLAY 后重试' : `Xvfb 异常退出(code ${code})`,
    )));
  });
}

export function displayNumberFor(pid) {
  return 1000 + (pid % 50000);
}

export async function ensureDisplay({ env = process.env, spawnImpl = spawn, timeoutMs = 5000 } = {}) {
  if (env.DISPLAY) return;
  const args = [
    `:${displayNumberFor(process.pid)}`, '-displayfd', '3',
    '-screen', '0', '640x480x24', '-nolisten', 'tcp',
  ];
  const child = spawnImpl('sh', ['-c', WATCHDOG, 'bnd-xvfb', ...args], {
    stdio: ['pipe', 'ignore', 'ignore', 'pipe'],
  });
  let number;
  try {
    number = await readDisplayNumber(child, timeoutMs);
  } catch (e) {
    child.kill();
    throw e;
  }
  env.DISPLAY = `:${number}`;
  child.removeAllListeners('exit');
  child.stdio[3].destroy?.();
  child.stdio[0].unref?.();
  child.unref();
  watchdog = child;
}
