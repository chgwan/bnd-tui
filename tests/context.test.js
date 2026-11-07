import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRemote, joinRemote } from '../src/shell/context.js';

test('resolveRemote 支持绝对/相对/上级路径', () => {
  assert.equal(resolveRemote('/', 'a'), '/a');
  assert.equal(resolveRemote('/a/b', 'c'), '/a/b/c');
  assert.equal(resolveRemote('/a/b', '..'), '/a');
  assert.equal(resolveRemote('/a/b', '/x'), '/x');
  assert.equal(resolveRemote('/a/b', '.'), '/a/b');
  assert.equal(resolveRemote('/a/b/c', '../d'), '/a/b/d');
});

test('resolveRemote 归一化重复斜杠与尾部斜杠', () => {
  assert.equal(resolveRemote('/a//b/', 'c/'), '/a/b/c');
  assert.equal(resolveRemote('/', '/'), '/');
});

test('resolveRemote 上越根目录钳制在根', () => {
  assert.equal(resolveRemote('/', '..'), '/');
  assert.equal(resolveRemote('/a', '../../x'), '/x');
});

test('joinRemote 组合远端路径', () => {
  assert.equal(joinRemote('/a', 'b', 'c'), '/a/b/c');
  assert.equal(joinRemote('/', 'b'), '/b');
});
