// 登录态:凭证规范化、内核 set_login_state、持久化(~/.config/bnd-tui/credentials.json,0600)。
// 官方恢复机制即“JS 侧持久化凭证后重新喂给内核”(load_local_login_info 是死代码,官方从未调用)。
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeCode } from '../kernel/errors.js';
import { noteLoggedIn } from '../kernel/init.js';

const HOME = process.env.BND_HOME ?? os.homedir();
const DIR = path.join(HOME, '.config', 'bnd-tui');
export const CREDS_PATH = path.join(DIR, 'credentials.json');

// 字段顺序与官方 main.js 的 set_login_state 现场逐字一致(sign_key 首位)
export function normalizeCreds(raw = {}) {
  const bduss = raw.bduss ?? raw.BDUSS ?? '';
  const stoken = raw.stoken ?? raw.STOKEN ?? '';
  return {
    sign_key: raw.sign_key ?? '',
    bduss,
    stoken,
    pass_stoken: raw.pass_stoken ?? raw.PASS_STOKEN ?? '',
    vip_flag: Number(raw.vip_flag ?? 0) || 0,
    vip_level: Number(raw.vip_level ?? 0) || 0,
    uk: raw.uk ?? '',
    wdr: raw.wdr ?? '',
    mdr: raw.mdr ?? '',
    cookies: [`BDUSS=${bduss}`, `STOKEN=${stoken}`],
  };
}

export function applyLogin(api, creds) {
  const rc = api.browser_engine_set_login_state(JSON.stringify(creds));
  if (rc === 0) {
    noteLoggedIn();
    return { ok: true, code: rc, msg: '登录成功' };
  }
  return { ok: false, code: rc, msg: `登录失败:${describeCode(rc)}` };
}

export function saveCreds(creds, userInfo = null) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2) + '\n', { mode: 0o600 });
  chmodSync(CREDS_PATH, 0o600);
  if (userInfo) {
    const snap = {
      username: userInfo.username ?? '',
      uk: String(userInfo.uk ?? creds.uk ?? ''),
      vip_type: Number(userInfo.vip_type ?? 0) || 0,
      vip_level: Number(userInfo.vip_level ?? 0) || 0,
    };
    writeFileSync(USER_INFO_PATH, JSON.stringify(snap, null, 2) + '\n', { mode: 0o600 });
    chmodSync(USER_INFO_PATH, 0o600);
  }
}

export const USER_INFO_PATH = path.join(DIR, 'user.json');

export function loadUserInfo() {
  if (!existsSync(USER_INFO_PATH)) return null;
  try {
    return JSON.parse(readFileSync(USER_INFO_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export function loadCreds() {
  if (!existsSync(CREDS_PATH)) return null;
  try {
    return normalizeCreds(JSON.parse(readFileSync(CREDS_PATH, 'utf8')));
  } catch {
    return null;
  }
}

export function logout(api) {
  try {
    if (api) api.browser_engine_clear_login_state();
  } finally {
    rmSync(CREDS_PATH, { force: true });
    rmSync(USER_INFO_PATH, { force: true });
  }
}
