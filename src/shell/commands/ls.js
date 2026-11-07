// bnd ls [路径]:列目录。官方调用现场:
//   fetch_file_list(cid, dirPath, startIndex, pageCount=1000, sortType, isSortDesc, out_total*, cb)
//   回调 (fileMetaStr, len, curPageCount, errorMsg, errorMsgLen, cookie, errorNo, hasNext)
import koffi from 'koffi';
import { PROTOS } from '../../kernel/glue.gen.js';
import { describeCode } from '../../kernel/errors.js';
import { resolveRemote } from '../context.js';
import { formatSize } from '../../util/format.js';

const PAGECOUNT = 1000; // 官方常量 _r=1e3
const PAGE_TIMEOUT_MS = 30000;
const SORT = { name: 0, size: 1, mtime: 2 }; // 官方 FileListSortType

function formatLocalTime(seconds) {
  const d = new Date(seconds * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function renderFileTable(files) {
  const sorted = [...files].sort((a, b) => {
    const ad = Number(a.isdir), bd = Number(b.isdir);
    if (ad !== bd) return bd - ad; // 目录优先
    return String(a.server_filename).localeCompare(String(b.server_filename), 'zh-Hans-CN');
  });
  const nameWidth = Math.min(
    48,
    Math.max(4, ...sorted.map((f) => f.server_filename.length)),
  );
  const lines = ['名称'.padEnd(nameWidth + 1) + '大小'.padStart(10) + '  修改时间'];
  for (const f of sorted) {
    const name = f.server_filename + (Number(f.isdir) ? '/' : '');
    const size = Number(f.isdir) ? '-' : formatSize(f.size);
    const date = f.server_mtime ? formatLocalTime(f.server_mtime) : '-';
    lines.push(name.padEnd(nameWidth + 1).slice(0, nameWidth + 1) + size.padStart(10) + '  ' + date);
  }
  return lines.join('\n');
}

// 内核文件对象无 server_filename,数值字段全是字符串;同官方 main.js 的映射在入口规范化
function normalizeFile(f) {
  return {
    ...f,
    path: f.server_path,
    server_filename: f.server_path.split('/').pop(),
    isdir: Number(f.is_dir),
    size: Number(f.size),
    server_mtime: Number(f.server_mtime),
  };
}

export async function fetchAllPages(api, { dirPath, cid = '0', sortType = SORT.name, desc = false, onPage }) {
  const collected = [];
  let start = 0;
  let resolveCurrent = null;
  const handler = (r) => resolveCurrent?.(r);
  // 原生 8 参回调包装,onPage 暴露它供测试伪内核直调
  const rawCb = (filesJson, _len, _count, _errMsg, _errLen, _cookie, errorNo, hasNext) => handler({ errorNo, filesJson, hasNext });
  if (onPage) onPage(rawCb);
  // 回调指针须被持有:挂到模块级注册表(与事件总线同一约束)
  const cbPtr = koffi.register(rawCb, koffi.pointer(PROTOS.FetchFileList));
  FETCH_CB_REFS.add(cbPtr);

  for (;;) {
    const outTotal = [BigInt(-1)];
    const rc = api.browser_engine_fetch_file_list(
      cid, dirPath, start, PAGECOUNT, sortType, desc, outTotal, cbPtr,
    );
    if (rc !== 0) throw new Error(`列目录失败:${describeCode(rc)}`);
    // 定时器同时保活事件循环:koffi 回调不算活动句柄,否则 Node 会在等待时退出、
    // 卸载原生库,内核线程回调时跳进已卸载的代码而段错误
    const page = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('列目录超时')), PAGE_TIMEOUT_MS);
      resolveCurrent = (r) => { clearTimeout(timer); resolve(r); };
    });
    if (page.errorNo !== 0) throw new Error(`列目录失败:${describeCode(page.errorNo)}`);
    const files = JSON.parse(page.filesJson || '[]');
    collected.push(...files.map(normalizeFile));
    if (!page.hasNext || files.length === 0) return collected;
    start += files.length;
  }
}

const FETCH_CB_REFS = new Set();

export async function run(ctx, args) {
  const dirPath = resolveRemote(ctx.cwd ?? '/', args[0]);
  const files = await fetchAllPages(ctx.api, { dirPath });
  console.log(`${dirPath}  共 ${files.length} 项`);
  console.log(renderFileTable(files));
}
