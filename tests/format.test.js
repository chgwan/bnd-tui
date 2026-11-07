import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSize, formatSpeed, renderBar } from '../src/util/format.js';

test('formatSize 常见量级', () => {
  assert.equal(formatSize(0), '0 B');
  assert.equal(formatSize(1536), '1.5 KB');
  assert.equal(formatSize(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatSize(3.5 * 1024 ** 3), '3.5 GB');
});

test('formatSpeed 以每秒为单位', () => {
  assert.equal(formatSpeed(2048), '2.0 KB/s');
});

test('renderBar 生成括号进度条与百分比后缀', () => {
  const bar = renderBar(5, 10, 10);
  assert.ok(bar.startsWith('['), bar);
  assert.ok(/\]\s*50%$/.test(bar), bar);
});

test('renderBar total 为 0 不除零', () => {
  const bar = renderBar(0, 0, 10);
  assert.ok(bar.includes('0%'));
});
