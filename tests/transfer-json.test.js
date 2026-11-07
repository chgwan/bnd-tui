import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDownloadPayload, buildUploadPayload, splitTargets } from '../src/shell/commands/download.js';

test('buildDownloadPayload 生成官方形状:条目数组,local_path 为保存目录', () => {
  const p = JSON.parse(buildDownloadPayload({
    files: [{ is_dir: 0, md5: 'abc', server_path: '/dir/f.bin', size: 42 }],
    savePath: '/data/dl',
  }));
  assert.deepEqual(p, [{ md5: 'abc', size: 42, is_dir: 0, server_path: '/dir/f.bin', from_manual: 1, local_path: '/data/dl' }]);
});

test('buildUploadPayload 生成官方形状:local_path + is_dir', () => {
  const p = JSON.parse(buildUploadPayload(['/tmp/a.txt', '/tmp/b 文件🎉.mp4']));
  assert.deepEqual(p, [
    { local_path: '/tmp/a.txt', is_dir: 0 },
    { local_path: '/tmp/b 文件🎉.mp4', is_dir: 0 },
  ]);
});

test('splitTargets 无 --to 时不丢第一个路径', () => {
  assert.deepEqual(splitTargets(['/a', '/b']), { targets: ['/a', '/b'], to: undefined });
  assert.deepEqual(splitTargets(['/a', '--to', '/d', '/b']), { targets: ['/a', '/b'], to: '/d' });
});

test('findEntryByName 在 ls 结果中按文件名匹配(中文名)', async () => {
  const { findEntryByName } = await import('../src/shell/commands/download.js');
  const files = [{ server_filename: '文件 名🎉.mp4', isdir: 0, size: 7, md5: 'm1' }];
  const hit = findEntryByName(files, '文件 名🎉.mp4');
  assert.equal(hit.md5, 'm1');
  assert.equal(findEntryByName(files, 'nope'), undefined);
});
