import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmExit } from '../src/shell/repl.js';

test('confirmExit 无活动任务时直接退出', () => {
  assert.equal(confirmExit({ active: 0 }), true);
  assert.equal(confirmExit({}), true);
});

test('confirmExit 有活动任务时第一次拦下,第二次放行', () => {
  const ctx = { active: 1 };
  const orig = console.log;
  const lines = [];
  console.log = (s) => lines.push(String(s));
  try {
    assert.equal(confirmExit(ctx), false);
    assert.equal(confirmExit(ctx), true);
  } finally {
    console.log = orig;
  }
  assert.ok(lines[0].includes('中断'));
});
