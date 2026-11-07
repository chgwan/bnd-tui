import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerCommand, getCommand, commandNames, makeCtx } from '../src/shell/registry.js';

test('registerCommand 注册后可查询、重名抛错', () => {
  registerCommand('zz-test', { run: async () => {} });
  assert.ok(getCommand('zz-test'));
  assert.throws(() => registerCommand('zz-test', { run: async () => {} }), /重复注册/);
});

test('commandNames 返回已注册命令名', () => {
  assert.ok(commandNames().includes('zz-test'));
});

test('makeCtx 初始 cwd 为根目录', () => {
  const ctx = makeCtx();
  assert.equal(ctx.cwd, '/');
  assert.ok(ctx.api === undefined);
});
