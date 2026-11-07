import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeCode, BrowserCode } from '../src/kernel/errors.js';

test('describeCode(0) 表示成功', () => {
  assert.match(describeCode(0), /成功/);
});

test('describeCode(10) 提示需要登录', () => {
  assert.match(describeCode(10), /登录/);
});

test('describeCode(7) 提示参数无效', () => {
  assert.match(describeCode(7), /参数/);
});

test('describeCode 未知码回退为含数字的提示', () => {
  const msg = describeCode(987654);
  assert.match(msg, /987654/);
});

test('BrowserCode.OK === 0', () => {
  assert.equal(BrowserCode.OK, 0);
});
