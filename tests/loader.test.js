import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { loadEngine, DEFAULT_ENGINE_PATH } from '../src/kernel/loader.js';

test('loadEngine 在引擎文件缺失时抛出含库文件名的中文错误', () => {
  assert.throws(
    () => loadEngine({ enginePath: '/nonexistent/dir/libbrowserengine.so' }),
    /libbrowserengine\.so/,
  );
});

test('loadEngine 加载真实引擎并返回 x.y 开头的版本号', { skip: !existsSync(DEFAULT_ENGINE_PATH) }, () => {
  const { api } = loadEngine();
  assert.match(api.get_version(), /^\d+\.\d+/);
});
