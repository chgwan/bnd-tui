// bnd download <远端路径...> [--to 本地目录]:经官方 P2SP 内核下载。单发模式等待完成,REPL 中后台运行。
// 官方现场(addDownloadTask):files_by_check 不成立时回退 self_files,
// 条目 {md5, size, is_dir, server_path, from_manual, local_path=保存目录}。
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { describeCode } from '../../kernel/errors.js';
import { resolveRemote } from '../context.js';
import { fetchAllPages } from './ls.js';
import { runTransfer } from './tasks.js';
import { loadConfig } from '../../config.js';

const FILE_TYPE_SELF = 1; // 官方 {self:1, share:2}

export function buildDownloadPayload({ files, savePath }) {
  return JSON.stringify(files.map((f) => ({
    md5: f.md5 ?? '',
    size: Number(f.size) || 0,
    is_dir: Number(f.is_dir) || 0,
    server_path: f.server_path,
    from_manual: 1,
    local_path: savePath,
  })));
}

export function buildUploadPayload(localPaths) {
  return JSON.stringify(localPaths.map((lp) => ({ local_path: lp, is_dir: 0 })));
}

export function splitTargets(args) {
  const i = args.indexOf('--to');
  if (i < 0) return { targets: args, to: undefined };
  return { targets: args.filter((_, k) => k !== i && k !== i + 1), to: args[i + 1] };
}

export function findEntryByName(files, name) {
  return files.find((f) => f.server_filename === name);
}

export async function resolveEntry(api, remotePath) {
  const parent = resolveRemote(remotePath, '..');
  const name = remotePath.split('/').filter(Boolean).pop() ?? '';
  const files = await fetchAllPages(api, { dirPath: parent });
  const hit = findEntryByName(files, name);
  if (!hit) throw new Error(`云端不存在:${remotePath}`);
  return { entry: hit, parent };
}

export async function run(ctx, args) {
  const { targets, to } = splitTargets(args);
  const savePath = path.resolve(to ?? loadConfig().download_dir);
  if (!existsSync(savePath) || !statSync(savePath).isDirectory()) {
    throw new Error(`本地目录不存在:${savePath}(可用 --to 指定)`);
  }
  if (targets.length === 0) throw new Error('用法:bnd download <远端路径> [--to 本地目录]');

  const items = [];
  for (const t of targets) {
    const remotePath = resolveRemote(ctx.cwd ?? '/', t);
    const { entry } = await resolveEntry(ctx.api, remotePath);
    items.push({ is_dir: entry.isdir, md5: entry.md5, server_path: remotePath, size: entry.size });
  }
  const payload = buildDownloadPayload({ files: items, savePath });
  await runTransfer(ctx, {
    isDownload: true,
    start: () => {
      if (ctx.api.browser_engine_download_files_by_check('0', FILE_TYPE_SELF, payload) === 0) return;
      const rc = ctx.api.browser_engine_download_self_files('0', payload);
      if (rc !== 0) throw new Error(`创建下载任务失败:${describeCode(rc)}`);
    },
    doneMessage: `下载完成:${items.length} 项 → ${savePath}`,
    failPrefix: '下载失败',
  });
}
