// bnd whoami:经内核查询当前用户,失败时回退登录时的快照。
import { loadCreds, loadUserInfo } from '../../auth/state.js';
import { buildCookieJson } from '../../auth/qr.js';
import { kernelPost } from '../../auth/kernelhttp.js';
import { LOGIN_STATUS_URL } from './login.js';

export async function run(ctx) {
  const creds = loadCreds();
  if (!creds) {
    console.log('未登录。使用:bnd login 扫码,或 bnd login --bduss <值> --stoken <值>');
    return;
  }
  const status = await kernelPost(ctx.api, LOGIN_STATUS_URL, {}, buildCookieJson(creds.bduss, creds.stoken)).catch(() => null);
  const info = status?.login_info;
  const src = info ?? loadUserInfo() ?? {};
  const vip = Number(src.vip_type) ? ` (会员等级 ${src.vip_level})` : '';
  const tag = info ? '' : '(登录时快照)';
  console.log(`用户:${src.username || '?'}  uk=${src.uk ?? creds.uk}${vip} ${tag}`);
}
