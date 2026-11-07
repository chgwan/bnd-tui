// bnd rm <远端文件...>:删除网盘文件,进回收站。只删文件,目录会报错。
// 官方现场:POST /api/filemanager?async=0&onnest=fail&opera=delete&bdstoken=…,表单 filelist=路径 JSON 数组。
import { loadCreds } from '../../auth/state.js';
import { buildCookieJson } from '../../auth/qr.js';
import { kernelPost } from '../../auth/kernelhttp.js';
import { resolveRemote } from '../context.js';
import { resolveEntry } from './download.js';
import { LOGIN_STATUS_URL } from './login.js';

const FILEMANAGER_URL = 'https://pan.baidu.com/api/filemanager';

export function buildDeleteRequest(paths, bdstoken) {
  const query = new URLSearchParams({ async: '0', onnest: 'fail', opera: 'delete', bdstoken });
  return { url: `${FILEMANAGER_URL}?${query}`, form: { filelist: JSON.stringify(paths) } };
}

export function assertDeletable(entry, remotePath) {
  if (Number(entry.isdir) === 1) throw new Error(`是目录,rm 只删文件:${remotePath}`);
}

export function checkDeleteResult(res) {
  const failed = (res?.info ?? []).filter((i) => i.errno !== 0);
  if (failed.length > 0) throw new Error(`删除失败:${failed.map((i) => `${i.path}(errno=${i.errno})`).join(';')}`);
  if (res?.errno !== 0) throw new Error(`删除失败:errno=${res?.errno}`);
}

export async function run(ctx, args) {
  if (args.length === 0) throw new Error('用法:bnd rm <远端文件...>');
  const creds = loadCreds();
  if (!creds) throw new Error('未登录');
  const paths = args.map((a) => resolveRemote(ctx.cwd ?? '/', a));
  for (const p of paths) assertDeletable((await resolveEntry(ctx.api, p)).entry, p);

  const cookie = buildCookieJson(creds.bduss, creds.stoken);
  const status = await kernelPost(ctx.api, LOGIN_STATUS_URL, {}, cookie);
  const bdstoken = status?.login_info?.bdstoken;
  if (!bdstoken) throw new Error('删除失败:取不到 bdstoken');
  const { url, form } = buildDeleteRequest(paths, bdstoken);
  checkDeleteResult(await kernelPost(ctx.api, url, form, cookie));
  console.log(`已删除 ${paths.length} 项(在回收站)`);
}
