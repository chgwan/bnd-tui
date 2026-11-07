import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { buildCommonConfig, noteLoggedIn } from '../src/kernel/init.js';
import { ensureDisplay, displayNumberFor } from '../src/kernel/display.js';
import { withShim } from '../src/kernel/shim.js';

test('buildCommonConfig 与官方 COMMONPARAM 形状一致', () => {
  assert.deepEqual(buildCommonConfig({ release: '4.18.0-553.el8.x86_64', arch: 'x64' }), {
    netdisk_root: 'https://pan.baidu.com/',
    ua: 'netdisk;8.9.7;PC;PC-Linux;4.18.0;UniBaiduYunGuanJia',
    channel: 'Linux_4.18.0_Uniyunguanjia_netdisk_00000000',
    app_version: '8.9.7',
    client_type: '35',
  });
  assert.match(buildCommonConfig({ release: '5.1', arch: 'arm64' }).ua, /PC-Linux-aarch64;5\.1;/);
});

test('noteLoggedIn 在内核未启动时无副作用', () => {
  assert.doesNotThrow(() => noteLoggedIn());
});

function fakeXvfb({ fail } = {}) {
  const calls = [];
  const spawnImpl = (cmd, args) => {
    calls.push({ cmd, args });
    const child = new EventEmitter();
    child.stdio = [new PassThrough(), null, null, new PassThrough()];
    child.unref = () => {};
    child.kill = () => {};
    setImmediate(() => (fail ? child.emit('exit', fail) : child.stdio[3].write('42\n')));
    return child;
  };
  return { calls, spawnImpl };
}

test('ensureDisplay 已有 DISPLAY 时不启动 Xvfb', async () => {
  const { calls, spawnImpl } = fakeXvfb();
  const env = { DISPLAY: ':7' };
  await ensureDisplay({ env, spawnImpl });
  assert.equal(calls.length, 0);
  assert.equal(env.DISPLAY, ':7');
});

test('ensureDisplay 无 DISPLAY 时经看门狗启动私有 Xvfb 并设置 DISPLAY', async () => {
  const { calls, spawnImpl } = fakeXvfb();
  const env = {};
  await ensureDisplay({ env, spawnImpl });
  assert.equal(calls[0].cmd, 'sh');
  assert.ok(!calls[0].args.includes('-terminate'));
  assert.ok(calls[0].args.includes(`:${displayNumberFor(process.pid)}`));
  assert.equal(env.DISPLAY, ':42');
});

test('displayNumberFor 不同 PID 得到不同 display 号,且避开常用低位号', () => {
  assert.notEqual(displayNumberFor(1234), displayNumberFor(1235));
  assert.ok(displayNumberFor(0) >= 1000);
});

test('ensureDisplay 缺 Xvfb 时给出中文提示', async () => {
  const { spawnImpl } = fakeXvfb({ fail: 127 });
  await assert.rejects(ensureDisplay({ env: {}, spawnImpl }), /Xvfb/);
});

test('withShim 把垫片排在 LD_PRELOAD 最前', () => {
  const yes = () => true;
  assert.equal(withShim({}, '/s.so', yes).LD_PRELOAD, '/s.so');
  assert.equal(withShim({ LD_PRELOAD: '/a.so' }, '/s.so', yes).LD_PRELOAD, '/s.so:/a.so');
});

test('withShim 在垫片缺失或被禁用时不改环境', () => {
  assert.equal(withShim({}, '/s.so', () => false).LD_PRELOAD, undefined);
  assert.equal(withShim({ BND_NO_SHIM: '1' }, '/s.so', () => true).LD_PRELOAD, undefined);
});
