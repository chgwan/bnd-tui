// bnd login:两种形态 —— 无参数:扫码(full 安装);--bduss/--stoken:引导登录(基础安装)。
import { assembleCreds, buildCookieJson } from '../../auth/qr.js';
import { kernelPost } from '../../auth/kernelhttp.js';
import { applyLogin, logout, saveCreds } from '../../auth/state.js';
import { chooseLoginMode, probeFullInstall, qrLoginHeadless } from '../../auth/qrheadless.js';

const UINFO_URL = 'https://pan.baidu.com/api/account/uinfo?udr=1';
const REPORT_URL = 'https://pan.baidu.com/api/report/user';
export const LOGIN_STATUS_URL = 'https://pan.baidu.com/api/loginStatus';

export function parseLoginArgs(args) {
  const get = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const bduss = get('--bduss');
  const stoken = get('--stoken');
  if (!bduss) throw new Error('缺少 --bduss(浏览器登录 pan.baidu.com 后从 Cookie 复制)');
  if (!stoken) throw new Error('缺少 --stoken(同上,与 BDUSS 一起复制)');
  return { bduss, stoken };
}

// 官方序列(__getUk → __buriedPoint → $setLoginState):
// uinfo 给 uk/wdr/mdr,report/user 的 uinfo 字段即 sign_key。
export async function completeLogin(ctx, { bduss, stoken, passStoken = '' }) {
  const post = ctx.kernelPost ?? kernelPost;
  const cookieJson = buildCookieJson(bduss, stoken);

  const info = await post(ctx.api, UINFO_URL, {}, cookieJson);
  if (!(info.uk && info.wdr && info.mdr)) {
    throw new Error(`登录失败:uinfo 未返回 uk/wdr/mdr(errno=${info.errno},字段:${Object.keys(info).join(',')})`);
  }

  const report = await post(
    ctx.api,
    REPORT_URL,
    { action: 'pc_uniyunguanjia_login', cookies: cookieJson, timestamp: Date.now() / 1000 },
    cookieJson,
  );
  if (!report.uinfo) {
    throw new Error(`登录失败:report/user 未返回 sign_key(errno=${report.errno})`);
  }

  // 用户名与会员信息只在 loginStatus 里,取不到不影响登录
  const status = await post(ctx.api, LOGIN_STATUS_URL, {}, cookieJson).catch(() => null);
  Object.assign(info, status?.login_info ?? {});

  const creds = assembleCreds({ bduss, stoken, passStoken, signKey: report.uinfo }, info);
  // 先落盘:内核可能在 set_login_state 内崩溃,不能让一次扫码白费;内核明确拒绝时再撤销
  saveCreds(creds, info);
  const r = applyLogin(ctx.api, creds);
  if (!r.ok) {
    logout(null);
    throw new Error(r.msg);
  }
  const name = info.username ?? `uk=${creds.uk}`;
  console.log(`登录成功:${name}${creds.vip_level ? `(SVIP${creds.vip_level})` : ''}`);
}

export async function run(ctx, args) {
  const mode = chooseLoginMode(args, await probeFullInstall());

  if (mode === 'bootstrap') {
    const { bduss, stoken } = parseLoginArgs(args);
    await completeLogin(ctx, { bduss, stoken });
    return;
  }

  if (mode === 'qr') {
    const r = await qrLoginHeadless({
      timeoutMs: Number(process.env.BND_QR_TIMEOUT_MS) || 180000,
    });
    await completeLogin(ctx, r);
    return;
  }

  console.error(
    '当前为轻量安装,扫码组件未安装。两种登录方式:\n' +
      '  1) npm run install:full  安装 playwright + Chromium(约 400MB),之后 bnd login 即扫码\n' +
      '  2) bnd login --bduss <值> --stoken <值>  浏览器登录 pan.baidu.com 后从 Cookie 复制这两个值',
  );
  process.exitCode = 1;
}
