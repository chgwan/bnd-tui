// bnd upload <本地文件...> [--to 远端目录]:上传到网盘。单发模式等待完成,REPL 中后台运行。
// 官方现场:upload_files(cid="0", [{local_path, is_dir}], 远端目录)。
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { describeCode } from '../../kernel/errors.js';
import { resolveRemote } from '../context.js';
import { buildUploadPayload, splitTargets } from './download.js';
import { runTransfer } from './tasks.js';

export async function run(ctx, args) {
  const { targets, to } = splitTargets(args);
  const remoteDir = to ? resolveRemote(ctx.cwd ?? '/', to) : (ctx.cwd ?? '/');
  if (targets.length === 0) throw new Error('用法:bnd upload <本地文件...> [--to 远端目录]');
  for (const t of targets) {
    if (!existsSync(t) || !statSync(t).isFile()) throw new Error(`本地文件不存在(或不是普通文件):${t}`);
  }
  const payload = buildUploadPayload(targets.map((t) => path.resolve(t)));
  await runTransfer(ctx, {
    isDownload: false,
    start: () => {
      const rc = ctx.api.browser_engine_upload_files('0', payload, remoteDir);
      if (rc !== 0) throw new Error(`创建上传任务失败:${describeCode(rc)}`);
    },
    doneMessage: `上传完成:${targets.length} 项 → ${remoteDir}`,
    failPrefix: '上传失败',
  });
}
