import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePollStatus, buildCookieJson, assembleCreds } from '../src/auth/qr.js';
import { encodeForm } from '../src/auth/kernelhttp.js';
import { chromiumEnv, pickCookie } from '../src/auth/qrheadless.js';

test('parsePollStatus 状态机:等待/已扫码待确认/已确认', () => {
  assert.deepEqual(parsePollStatus({ errno: 0, status: 0 }), { phase: 'waiting' });
  assert.deepEqual(parsePollStatus({ errno: 0, status: 1 }), { phase: 'scanned' });
  assert.deepEqual(
    parsePollStatus({ errno: 0, status: 4, bduss: 'B1' }),
    { phase: 'confirmed', bduss: 'B1' },
  );
});

test('parsePollStatus 二维码过期与错误码', () => {
  assert.equal(parsePollStatus({ errno: 0, status: 2 }).phase, 'expired');
  const r = parsePollStatus({ errno: -1 });
  assert.equal(r.phase, 'error');
});

test('buildCookieJson 与官方现场逐字一致', () => {
  assert.equal(
    buildCookieJson('b1', 's1'),
    '{"cookies":["BDUSS=b1", "STOKEN=s1"]}',
  );
});

test('assembleCreds 用 exchange + loginStatus 组装完整凭证', () => {
  const creds = assembleCreds(
    { bduss: 'B', stoken: 'S', signKey: 'K' },
    { uk: '42', vip_type: 1, vip_level: 3, username: 'alice' },
  );
  assert.equal(creds.bduss, 'B');
  assert.equal(creds.stoken, 'S');
  assert.equal(creds.sign_key, 'K');
  assert.equal(creds.uk, '42');
  assert.equal(creds.vip_flag, 1);
  assert.equal(creds.vip_level, 3);
  assert.equal(creds.cookies[0], 'BDUSS=B');
});

test('assembleCreds loginStatus 缺字段时安全回退', () => {
  const creds = assembleCreds({ bduss: 'B', stoken: 'S' }, {});
  assert.equal(creds.uk, '');
  assert.equal(creds.vip_flag, 0);
});

test('encodeForm 按官方 qs 规则编码(空格为 %20)', () => {
  assert.equal(encodeForm({ a: 'x y', b: 1.5 }), 'a=x%20y&b=1.5');
  assert.equal(encodeForm({}), '');
});

test('pickCookie 同名 cookie 优先 pan 域,其次 .baidu.com', () => {
  const jar = [
    { name: 'STOKEN', domain: 'passport.baidu.com', value: 'pass' },
    { name: 'STOKEN', domain: '.pan.baidu.com', value: 'pan' },
  ];
  assert.equal(pickCookie(jar, 'STOKEN'), 'pan');
  assert.equal(pickCookie(jar.slice(0, 1), 'STOKEN'), 'pass');
  assert.equal(pickCookie(jar, 'BDUSS'), undefined);
});

test('chromiumEnv 不传 DISPLAY', () => {
  const saved = process.env.DISPLAY;
  process.env.DISPLAY = ':1234';
  try {
    assert.equal(chromiumEnv().DISPLAY, undefined);
  } finally {
    if (saved === undefined) delete process.env.DISPLAY;
    else process.env.DISPLAY = saved;
  }
});
