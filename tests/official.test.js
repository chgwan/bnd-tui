import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { officialRoot, BUNDLED_ROOT, INSTALLED_ROOT } from '../src/kernel/official.js';

const engineIn = (root) => path.join(root, 'opt/baidunetdisk/libbrowserengine.so');

test('officialRoot 优先用 BND_OFFICIAL_ROOT', () => {
  assert.equal(officialRoot({ BND_OFFICIAL_ROOT: '/x' }, () => true), '/x');
});

test('officialRoot 其次用随包附带的内核', () => {
  assert.equal(officialRoot({}, (p) => p === engineIn(BUNDLED_ROOT)), BUNDLED_ROOT);
});

test('officialRoot 都没有时回到 ~/opt/baidunetdisk', () => {
  assert.equal(officialRoot({}, () => false), INSTALLED_ROOT);
});
