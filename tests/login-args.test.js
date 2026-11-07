import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(tmpdir(), 'bnd-login-'));
process.env.BND_HOME = TMP; // 必须在动态 import 之前,state.js 在模块初始化时绑定 HOME

const { parseLoginArgs, completeLogin } = await import('../src/shell/commands/login.js');
const { loadCreds, loadUserInfo } = await import('../src/auth/state.js');

test('parseLoginArgs 解析 --bduss/--stoken', () => {
  assert.deepEqual(parseLoginArgs(['--bduss', 'B1', '--stoken', 'S1']), { bduss: 'B1', stoken: 'S1' });
});

test('parseLoginArgs 缺参数时抛中文错误', () => {
  assert.throws(() => parseLoginArgs(['--bduss', 'B1']), /--stoken/);
  assert.throws(() => parseLoginArgs([]), /--bduss/);
});

// 官方序列:uinfo?udr=1 → report/user(uinfo 字段即 sign_key)→ set_login_state
function mockCtx({ uinfo, report }) {
  const posts = [];
  const states = [];
  const ctx = {
    api: { browser_engine_set_login_state: (json) => { states.push(JSON.parse(json)); return 0; } },
    kernelPost: async (api, url, params, cookieJson) => {
      posts.push({ url, params, cookieJson });
      return url.includes('/api/report/user') ? report : uinfo;
    },
  };
  return { ctx, posts, states };
}

const COOKIE = '{"cookies":["BDUSS=B", "STOKEN=S"]}';

test('completeLogin 走官方 uinfo → report/user 序列,sign_key 取 report 的 uinfo 字段', async () => {
  const { ctx, posts, states } = mockCtx({
    uinfo: { errno: 0, uk: 42, wdr: 'W', mdr: 'M', login_info: { username: 'alice', vip_type: 2, vip_level: 5 } },
    report: { errno: 0, uinfo: 'SIGN' },
  });
  await completeLogin(ctx, { bduss: 'B', stoken: 'S' });

  assert.equal(posts[0].url, 'https://pan.baidu.com/api/account/uinfo?udr=1');
  assert.deepEqual(posts[0].params, {});
  assert.equal(posts[0].cookieJson, COOKIE);
  assert.equal(posts[1].url, 'https://pan.baidu.com/api/report/user');
  assert.equal(posts[1].params.action, 'pc_uniyunguanjia_login');
  assert.equal(posts[1].params.cookies, COOKIE);
  assert.equal(typeof posts[1].params.timestamp, 'number');
  assert.equal(posts[1].cookieJson, COOKIE);

  assert.equal(posts[2].url, 'https://pan.baidu.com/api/loginStatus');
  assert.equal(loadUserInfo().username, 'alice');
  assert.equal(states[0].vip_level, 5);
  assert.equal(states[0].sign_key, 'SIGN');
  assert.equal(states[0].uk, '42');
  assert.equal(states[0].wdr, 'W');
  assert.equal(states[0].mdr, 'M');
  assert.equal(loadCreds().sign_key, 'SIGN');
});

test('completeLogin 在调用 set_login_state 前已落盘,内核拒绝时撤销', async () => {
  const { ctx } = mockCtx({
    uinfo: { errno: 0, uk: 42, wdr: 'W', mdr: 'M' },
    report: { errno: 0, uinfo: 'SIGN' },
  });
  let savedAtCall = null;
  ctx.api.browser_engine_set_login_state = () => { savedAtCall = loadCreds(); return 7; };
  await assert.rejects(completeLogin(ctx, { bduss: 'B', stoken: 'S' }), /登录失败/);
  assert.equal(savedAtCall.sign_key, 'SIGN');
  assert.equal(loadCreds(), null);
});

test('completeLogin uinfo 缺 uk/wdr/mdr 时报错,不调用 set_login_state', async () => {
  const { ctx, states } = mockCtx({ uinfo: { errno: 0, uk: 42 }, report: { errno: 0, uinfo: 'SIGN' } });
  await assert.rejects(completeLogin(ctx, { bduss: 'B', stoken: 'S' }), /uinfo/);
  assert.equal(states.length, 0);
});

test('completeLogin report 无 uinfo 时报错,不调用 set_login_state', async () => {
  const { ctx, states } = mockCtx({
    uinfo: { errno: 0, uk: 42, wdr: 'W', mdr: 'M' },
    report: { errno: -6 },
  });
  await assert.rejects(completeLogin(ctx, { bduss: 'B', stoken: 'S' }), /report.*-6/);
  assert.equal(states.length, 0);
});

test.after(() => rmSync(TMP, { recursive: true, force: true }));
