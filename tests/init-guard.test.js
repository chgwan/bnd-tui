import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkExclusive, parsePs } from '../src/kernel/init.js';
import { uninitKernel, isKernelUp } from '../src/kernel/init.js';

const PS = `  PID  PPID USER          STAT COMMAND
 3373376 3370000 alice.wonder Sl   /home/alice.wonder/opt/baidunetdisk/opt/baidunetdisk/baidunetdisk --no-sandbox
 3373726 3373376 alice.wonder Z    [netdisk_service] <defunct>
 4118129 3373376 alice.wonder Sl   /home/alice.wonder/opt/baidunetdisk/opt/baidunetdisk/netdisk_service
 9999999 1 other.user     Sl   /home/other/opt/baidunetdisk/baidunetdisk
 5555555 3370000 alice.wonder Sl   node /home/alice.wonder/Codes/bnd-tui/bin/bnd.js ls /notes/baidunetdisk_tips
`;

const line = (pid, ppid, cmd) => ` ${pid} ${ppid} alice.wonder Sl   ${cmd}\n`;
const SERVICE = '/home/alice.wonder/opt/baidunetdisk/opt/baidunetdisk/netdisk_service';
const HEADER = '  PID  PPID USER STAT COMMAND\n';
const ORPHAN = HEADER + line(4000, 1, SERVICE);
const IN_USE = HEADER + line(4000, 3000, SERVICE);
const GUI_ORPHANED = HEADER + line(4000, 1, `${SERVICE.replace('netdisk_service', 'baidunetdisk')} --no-sandbox`);

test('parsePs 识别本用户存活的官方进程,排除僵尸/他人/路径误匹配', () => {
  const procs = parsePs(PS, 'alice.wonder');
  assert.deepEqual(procs.map((p) => p.pid), [3373376, 4118129]);
});

test('parsePs 放行孤儿 netdisk_service,保留父进程存活的服务与 GUI', () => {
  assert.deepEqual(parsePs(ORPHAN, 'alice.wonder'), []);
  assert.deepEqual(parsePs(IN_USE, 'alice.wonder').map((p) => p.pid), [4000]);
  assert.deepEqual(parsePs(GUI_ORPHANED, 'alice.wonder').map((p) => p.pid), [4000]);
});

test('checkExclusive 孤儿服务不拦,使用中的服务要拦', () => {
  checkExclusive({ coexist: false, psOutput: ORPHAN, user: 'alice.wonder' });
  assert.throws(
    () => checkExclusive({ coexist: false, psOutput: IN_USE, user: 'alice.wonder' }),
    /--coexist/,
  );
});

test('checkExclusive 检测到官方进程时抛中文错误并提示 --coexist', () => {
  assert.throws(
    () => checkExclusive({ coexist: false, psOutput: PS, user: 'alice.wonder' }),
    /官方客户端或另一个 bnd[\s\S]*--coexist/,
  );
});

test('checkExclusive coexist 或无进程时不抛', () => {
  checkExclusive({ coexist: true, psOutput: PS, user: 'alice.wonder' });
  checkExclusive({ coexist: false, psOutput: HEADER, user: 'alice.wonder' });
});

test('未初始化时 uninitKernel 返回 false 且 isKernelUp 为 false', async () => {
  assert.equal(isKernelUp(), false);
  assert.equal(await uninitKernel(), false);
});
