import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import koffi from 'koffi';
import { loadEngine, DEFAULT_ENGINE_PATH } from '../src/kernel/loader.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CORE_ASAR = path.join(process.env.HOME, 'opt/baidunetdisk/opt/baidunetdisk/resources/core.asar');
const GEN = path.join(ROOT, 'src/kernel/glue.gen.js');
const live = existsSync(CORE_ASAR) && existsSync(DEFAULT_ENGINE_PATH);

test('make-glue 从官方 asar 重新生成 glue,含关键内核函数与 ≥300 个绑定', { skip: !live }, () => {
  execFileSync(process.execPath, ['scripts/make-glue.mjs'], { cwd: ROOT, stdio: 'pipe' });
  const text = readFileSync(GEN, 'utf8');
  for (const fn of [
    'browser_engine_global_init',
    'browser_engine_set_login_state',
    'browser_engine_fetch_file_list',
    'browser_engine_download_cloud_file',
  ]) {
    assert.ok(text.includes(fn), `生成物缺少 ${fn}`);
  }
  const bound = (text.match(/lib\.func\(/g) || []).length;
  assert.ok(bound >= 300, `绑定数 ${bound} < 300`);
});

test('glue.gen 可导入,PROTOS 含关键回调,declareAll 绑定真实内核', { skip: !live }, async () => {
  const { PROTOS, declareAll } = await import('../src/kernel/glue.gen.js');
  assert.ok(PROTOS.CommonEvent, '缺少 PROTOS.CommonEvent');
  assert.ok(PROTOS.InternalLog, '缺少 PROTOS.InternalLog');
  assert.ok(PROTOS.ExitFinished, '缺少 PROTOS.ExitFinished');
  const { lib } = loadEngine();
  const api = declareAll(lib);
  assert.equal(typeof api.browser_engine_fetch_file_list, 'function');
  assert.match(api.browser_engine_get_version(), /^\d+\.\d+/);
});
