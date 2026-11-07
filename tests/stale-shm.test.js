import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { clearStaleShm } from '../src/kernel/stale-shm.js';

function makeRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'bnd-shm-'));
  mkdirSync(path.join(root, 'user'));
  for (const n of ['upload.db', 'upload.db-wal', 'upload.db-shm', 'transmission.db-shm']) {
    writeFileSync(path.join(root, 'user', n), 'x');
  }
  return root;
}

test('clearStaleShm 只删被残留锁占住的 -shm,库和 WAL 不动', () => {
  const root = makeRoot();
  const removed = clearStaleShm(root, { isLocked: (p) => p.endsWith('upload.db-shm') });
  assert.deepEqual(removed, ['upload.db-shm']);
  assert.deepEqual(readdirSync(path.join(root, 'user')).sort(), ['transmission.db-shm', 'upload.db', 'upload.db-wal']);
});

test('clearStaleShm 没有残留锁时什么都不做', () => {
  const root = makeRoot();
  assert.deepEqual(clearStaleShm(root, { isLocked: () => false }), []);
  assert.equal(readdirSync(path.join(root, 'user')).length, 4);
});

test('clearStaleShm 目录不存在时返回空', () => {
  assert.deepEqual(clearStaleShm('/nonexistent/bnd-shm', { isLocked: () => true }), []);
});

test('clearStaleShm 单个文件探测失败不影响其他文件', () => {
  const root = makeRoot();
  const isLocked = (p) => {
    if (p.endsWith('transmission.db-shm')) throw new Error('EACCES');
    return true;
  };
  assert.deepEqual(clearStaleShm(root, { isLocked }), ['upload.db-shm']);
});
