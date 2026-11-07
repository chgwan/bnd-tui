#!/usr/bin/env node
// bnd 入口。glibc 在进程启动时缓存库搜索路径,进程内改 LD_LIBRARY_PATH 无效,
// 因此首次运行用正确环境 re-exec 自己(参照官方 run.sh 的做法)。
import { spawn } from 'node:child_process';
import { isSea } from 'node:sea';
import { fileURLToPath } from 'node:url';
import { withShim } from '../src/kernel/shim.js';
import { OFFICIAL_DEPS as DEPS } from '../src/kernel/official.js';

const depsReady = (process.env.LD_LIBRARY_PATH || '').split(':').includes(DEPS);

// 内核原生崩溃时由这个父进程报告;不转发信号,否则 shell 会打印 core dumped
const CRASH_SIGNALS = new Set(['SIGSEGV', 'SIGABRT', 'SIGBUS']);

if (process.env.BND_REEXEC !== '1') {
  const env = withShim({
    ...process.env,
    LD_LIBRARY_PATH: depsReady ? process.env.LD_LIBRARY_PATH : `${DEPS}:${process.env.LD_LIBRARY_PATH || ''}`,
    BND_REEXEC: '1',
  }, fileURLToPath(new URL('../native/bnd-shim.so', import.meta.url)));
  // 单文件可执行里 execPath 就是程序本身,不需要脚本路径
  const args = isSea() ? process.argv.slice(2) : process.argv.slice(1);
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    env,
  });
  // 否则 kill 父进程时子进程和内核会残留
  const FORWARDED = ['SIGTERM', 'SIGHUP', 'SIGINT'];
  for (const sig of FORWARDED) process.on(sig, () => child.kill(sig));
  child.on('exit', (code, signal) => {
    if (CRASH_SIGNALS.has(signal)) {
      console.error(`bnd 内核异常退出(${signal})。登录时可运行 bnd ls / 确认是否已登录;其他命令请重试`);
      process.exit(1);
    }
    if (signal) {
      for (const sig of FORWARDED) process.removeAllListeners(sig);
      process.kill(process.pid, signal);
    } else process.exit(code ?? 0);
  });
} else {
  const { main } = await import('../src/main.js');
  const { exitProcess } = await import('../src/kernel/init.js');
  try {
    const code = await main(process.argv.slice(2));
    exitProcess(process.exitCode || code || 0);
  } catch (e) {
    console.error(e && e.message ? e.message : String(e));
    process.exit(1);
  }
}
