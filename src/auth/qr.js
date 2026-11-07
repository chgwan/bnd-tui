// 扫码登录:passport 二维码接口 + pan.baidu.com/api/loginStatus(官方 webview 同款数据源)。
import { normalizeCreds } from './state.js';

const PASSPORT = 'https://passport.baidu.com';
// 与官方客户端一致的 UA(netdisk 客户端标识)
export const UA = 'netdisk';

async function jfetch(url, opts = {}) {
  const res = await (opts.fetchImpl ?? fetch)(url, {
    ...opts,
    headers: { 'User-Agent': UA, ...(opts.headers ?? {}) },
  });
  const text = await res.text();
  let body = text;
  const jsonp = text.match(/^\((.*)\);?$/s);
  if (jsonp) body = jsonp[1];
  try {
    return { status: res.status, headers: res.headers, json: JSON.parse(body), text: body };
  } catch {
    return { status: res.status, headers: res.headers, json: null, text: body };
  }
}

export async function fetchQr({ fetchImpl } = {}) {
  const r = await jfetch(`${PASSPORT}/v2/api/getqrcode?lp=pc&qrloginfrom=pc&apiver=v3&tpl=netdisk`, { fetchImpl });
  if (!r.json || r.json.errno !== 0) throw new Error(`获取二维码失败:${r.text.slice(0, 120)}`);
  return { sign: r.json.sign, imgurl: r.json.imgurl };
}

export function parsePollStatus(json) {
  if (!json || json.errno !== 0) return { phase: 'error', errno: json?.errno };
  switch (json.status) {
    case 0: return { phase: 'waiting' };
    case 1: return { phase: 'scanned' };
    case 2: return { phase: 'expired' };
    case 4: return { phase: 'confirmed', bduss: json.bduss ?? '' };
    default: return { phase: 'unknown', status: json.status };
  }
}

export async function pollQr(sign, { fetchImpl } = {}) {
  const r = await jfetch(
    `${PASSPORT}/v2/api/qrcode?lp=pc&qrloginfrom=pc&apiver=v3&tpl=netdisk&sign=${encodeURIComponent(sign)}`,
    { fetchImpl },
  );
  return parsePollStatus(r.json);
}

export async function exchangeBduss(bduss, { fetchImpl } = {}) {
  const r = await jfetch(
    `${PASSPORT}/v3/login/main/qrbdusslogin?bduss=${encodeURIComponent(bduss)}&loginVersion=v5&tpl=netdisk&apiver=v3`,
    { fetchImpl },
  );
  if (!r.json || r.json.errno !== 0) throw new Error(`qrbdusslogin 失败:${r.text.slice(0, 120)}`);
  const cookies = r.headers.getSetCookie?.() ?? [];
  const pick = (name) => cookies.find((c) => c.startsWith(`${name}=`))?.split(';')[0].slice(name.length + 1) ?? '';
  return {
    bduss: pick('BDUSS') || bduss,
    stoken: pick('STOKEN') || '',
    passStoken: pick('PASS_STOKEN') ?? '',
  };
}

export function buildCookieJson(bduss, stoken) {
  // 与官方 main.js 现场逐字一致(含空格);这是内核 HTTP 的 cookie 参数,不是请求体
  return `{"cookies":["BDUSS=${bduss}", "STOKEN=${stoken}"]}`;
}

export function assembleCreds(exchange, loginStatus = {}) {
  return normalizeCreds({
    sign_key: exchange.signKey,
    bduss: exchange.bduss,
    stoken: exchange.stoken,
    pass_stoken: exchange.passStoken,
    uk: String(loginStatus.uk ?? ''),
    wdr: loginStatus.wdr ?? '',
    mdr: loginStatus.mdr ?? '',
    vip_flag: loginStatus.vip_type ?? 0,
    vip_level: loginStatus.vip_level ?? 0,
  });
}
