import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(tmpdir(), 'bnd-auth-'));
process.env.BND_HOME = TMP;

const { normalizeCreds, applyLogin, saveCreds, loadCreds, CREDS_PATH, logout } = await import('../src/auth/state.js');

test('normalizeCreds 补全全部 11 个键,cookies 由 bduss/stoken 合成,vip 为数字', () => {
  const out = normalizeCreds({ BDUSS: 'b1', STOKEN: 's1', uk: '123' });
  assert.deepEqual(Object.keys(out), [
    'sign_key', 'bduss', 'stoken', 'pass_stoken', 'vip_flag', 'vip_level',
    'uk', 'wdr', 'mdr', 'cookies',
  ]);
  assert.equal(out.bduss, 'b1');
  assert.equal(out.stoken, 's1');
  assert.equal(out.pass_stoken, '');
  assert.equal(out.uk, '123');
  assert.equal(out.vip_flag, 0);
  assert.deepEqual(out.cookies, ['BDUSS=b1', 'STOKEN=s1']);
  const json = JSON.stringify(out);
  assert.ok(json.indexOf('"sign_key"') < json.indexOf('"bduss"'), 'sign_key 应排在首位');
});

test('normalizeCreds 已有字段不覆盖,大小写键兼容', () => {
  const out = normalizeCreds({ BDUSS: 'b', STOKEN: 's', uk: 'u', wdr: 'w', mdr: 'm', pass_stoken: 'p', sign_key: 'k', vip_flag: '1', vip_level: '2' });
  assert.equal(out.wdr, 'w');
  assert.equal(out.sign_key, 'k');
  assert.equal(out.pass_stoken, 'p');
  assert.equal(out.vip_flag, 1);
  assert.equal(out.vip_level, 2);
});

function fakeApi(rc) {
  const calls = [];
  return {
    calls,
    api: {
      browser_engine_set_login_state: (json) => { calls.push(json); return rc; },
      browser_engine_clear_login_state: () => { calls.push('clear'); return 0; },
    },
  };
}

test('applyLogin rc=0 → ok,传给内核的是 JSON 字符串', () => {
  const { api, calls } = fakeApi(0);
  const r = applyLogin(api, normalizeCreds({ BDUSS: 'b', STOKEN: 's', uk: '1' }));
  assert.equal(r.ok, true);
  assert.equal(typeof calls[0], 'string');
  assert.deepEqual(JSON.parse(calls[0]).cookies, ['BDUSS=b', 'STOKEN=s']);
});

test('applyLogin rc≠0 → ok:false 且消息来自 describeCode', () => {
  const { api } = fakeApi(7);
  const r = applyLogin(api, normalizeCreds({ BDUSS: 'b', STOKEN: 's' }));
  assert.equal(r.ok, false);
  assert.match(r.msg, /参数/);
});

test('saveCreds/loadCreds 往返一致且权限 0600;logout 删除并清理内核态', () => {
  const creds = normalizeCreds({ BDUSS: 'b', STOKEN: 's', uk: '9' });
  saveCreds(creds);
  assert.equal(statSync(CREDS_PATH).mode & 0o777, 0o600);
  assert.deepEqual(loadCreds(), creds);
  const { api, calls } = fakeApi(0);
  logout(api);
  assert.equal(calls[0], 'clear');
  assert.equal(existsSync(CREDS_PATH), false);
  assert.equal(loadCreds(), null);
});

test.after(() => rmSync(TMP, { recursive: true, force: true }));
