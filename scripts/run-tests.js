#!/usr/bin/env node
// 测试运行引导:确保 LD_LIBRARY_PATH 在进程启动前就包含官方 deps 目录,
// 否则 libbrowserengine.so 的 NEEDED 库(gtkmm 等)解析失败。
import { spawn } from 'node:child_process';

const DEPS = `${process.env.HOME}/opt/baidunetdisk/deps/usr/lib64`;
const hasDeps = (process.env.LD_LIBRARY_PATH || '').split(':').includes(DEPS);

if (hasDeps) {
  const child = spawn(process.execPath, ['--test'], { stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
} else {
  const env = {
    ...process.env,
    LD_LIBRARY_PATH: `${DEPS}:${process.env.LD_LIBRARY_PATH || ''}`,
    BND_REEXEC: '1',
  };
  const child = spawn(process.execPath, ['scripts/run-tests.js'], { stdio: 'inherit', env });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}
