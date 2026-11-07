import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeleteRequest, checkDeleteResult, assertDeletable } from '../src/shell/commands/rm.js';

test('buildDeleteRequest 生成官方 filemanager 形状', () => {
  const { url, form } = buildDeleteRequest(['/a/b c.bin', '/文件.txt'], 'tok');
  assert.equal(url, 'https://pan.baidu.com/api/filemanager?async=0&onnest=fail&opera=delete&bdstoken=tok');
  assert.deepEqual(JSON.parse(form.filelist), ['/a/b c.bin', '/文件.txt']);
});

test('assertDeletable 拒绝目录', () => {
  assert.throws(() => assertDeletable({ isdir: '1' }, '/d'), /是目录/);
  assert.throws(() => assertDeletable({ isdir: 1 }, '/d'), /是目录/);
  assert.doesNotThrow(() => assertDeletable({ isdir: '0' }, '/f'));
});

test('checkDeleteResult 报告总体失败和单项失败', () => {
  assert.doesNotThrow(() => checkDeleteResult({ errno: 0, info: [{ errno: 0, path: '/a' }] }));
  assert.throws(() => checkDeleteResult({ errno: -6 }), /删除失败.*-6/);
  assert.throws(() => checkDeleteResult({ errno: 12, info: [{ errno: -9, path: '/a' }] }), /\/a.*-9/);
  assert.throws(() => checkDeleteResult(null), /删除失败/);
});
