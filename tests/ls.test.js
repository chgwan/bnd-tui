import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderFileTable } from '../src/shell/commands/ls.js';
import { fetchAllPages } from '../src/shell/commands/ls.js';

// 内核实际返回的形状(实测):无 server_filename,数值字段全是字符串
const toKernelShape = (f) => ({
  server_path: `/some dir/${f.server_filename}`,
  is_dir: String(f.isdir),
  size: String(f.size),
  server_mtime: String(f.server_mtime),
});

const FILES = [
  { server_filename: '文件 名🎉.mp4', isdir: 0, size: 1536, server_mtime: 1762000000 },
  { server_filename: 'dir one', isdir: 1, size: 0, server_mtime: 1762000001 },
  { server_filename: 'z.txt', isdir: 0, size: 10, server_mtime: 1762000002 },
];

test('renderFileTable 目录优先排序、目录带 /、中文名不转义、含表头', () => {
  const out = renderFileTable(FILES);
  const lines = out.split('\n');
  assert.ok(lines[0].includes('名称'), '表头含"名称"');
  const dirIdx = out.indexOf('dir one/');
  const fileIdx = out.indexOf('文件 名🎉.mp4');
  assert.ok(dirIdx > 0 && dirIdx < fileIdx, '目录排在文件前');
  assert.ok(out.includes('1.5 KB'), out);
  assert.ok(!out.includes('\\u'), '不得出现转义序列');
});

function makeFakeApi(pages) {
  // pages: [{files, hasNext, errorNo}] 依页消费;回调即时触发
  let call = 0;
  let cbFn = null;
  const api = {
    browser_engine_fetch_file_list: (cid, dirPath, start, count, sortType, desc, outTotal, cbPtr) => {
      const page = pages[Math.min(call, pages.length - 1)];
      call++;
      outTotal[0] = BigInt(pages.reduce((n, p) => n + p.files.length, 0));
      const err = page.errorNo ?? 0;
      const json = JSON.stringify(page.files.map(toKernelShape));
      // 官方参数序:fileMetaStr, len, curPageCount, errorMsg, errorMsgLen, cookie, errorNo, hasNext
      setTimeout(() => cbFn(json, json.length, page.files.length, '', 0, 1, err, page.hasNext), 0);
      return 0;
    },
  };
  return { api, setCb: (fn) => { cbFn = fn; } };
}

test('fetchAllPages 翻页聚合直到 hasNext=false', async () => {
  const { api, setCb } = makeFakeApi([
    { files: FILES, hasNext: true },
    { files: [{ server_filename: 'more.bin', isdir: 0, size: 1, server_mtime: 0 }], hasNext: false },
  ]);
  const files = await fetchAllPages(api, { dirPath: '/', onPage: setCb, cid: '0' });
  assert.equal(files.length, 4);
  assert.ok(files.some((f) => f.server_filename === 'more.bin'));
  const dir = files.find((f) => f.server_filename === 'dir one');
  assert.equal(dir.isdir, 1);
  assert.equal(dir.path, '/some dir/dir one');
  assert.equal(files.find((f) => f.server_filename === 'z.txt').size, 10);
});

test('fetchAllPages 回调 errorNo 非零时抛 describeCode 消息', async () => {
  const { api, setCb } = makeFakeApi([{ files: [], hasNext: false, errorNo: -6 }]);
  await assert.rejects(
    () => fetchAllPages(api, { dirPath: '/', onPage: setCb, cid: '0' }),
    /登录/,
  );
});
