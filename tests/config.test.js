import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(tmpdir(), 'bnd-cfg-'));
process.env.BND_HOME = TMP;

// BND_HOME 注入后再加载模块
const { loadConfig, saveConfig, CONFIG_PATH } = await import('../src/config.js');

test('loadConfig 无文件时返回默认值', () => {
  const cfg = loadConfig();
  assert.equal(cfg.max_parallel, 3);
  assert.equal(cfg.p2p_mode, 2);
  assert.ok(cfg.download_dir.endsWith('Downloads/bnd'));
});

test('saveConfig 落盘且权限 0600,读回一致,未知 key 被忽略', () => {
  saveConfig({ download_dir: '/data/x', max_parallel: 5, evil_key: 'x' });
  const st = statSync(CONFIG_PATH);
  assert.equal(st.mode & 0o777, 0o600);
  const cfg = loadConfig();
  assert.equal(cfg.download_dir, '/data/x');
  assert.equal(cfg.max_parallel, 5);
  assert.ok(!('evil_key' in cfg));
});

test.after(() => rmSync(TMP, { recursive: true, force: true }));
