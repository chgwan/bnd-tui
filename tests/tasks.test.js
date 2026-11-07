import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderTaskPanel, parseTaskItem, parseTaskList, buildTaskActionPayload, summarizeEnd, isSettled,
  isFinished, runTransfer, createTaskTracker, controlApplied,
} from '../src/shell/commands/tasks.js';

// 内核实际返回的任务项(实测形状,数值字段全是字符串)
const RAW = { id: '7', name: 'b.bin', size: '100', finish_size: '40', rate: '10', status: '2', error: '0' };

test('parseTaskItem 解析内核字段', () => {
  assert.deepEqual(parseTaskItem(RAW), { id: '7', name: 'b.bin', total: 100, done: 40, speed: 10, status: '2', error: 0 });
});

test('parseTaskList 支持有任务(数组)与无任务(字符串)两种形状', () => {
  assert.equal(parseTaskList(JSON.stringify({ tasks: [RAW] })).length, 1);
  assert.deepEqual(parseTaskList(JSON.stringify({ tasks: '' })), []);
  assert.deepEqual(parseTaskList(''), []);
});

test('renderTaskPanel 渲染中文状态、截断长名、进度 0 不除错', () => {
  const out = renderTaskPanel([
    { id: '1', name: 'a'.repeat(80) + '.bin', total: 100, done: 50, speed: 10, status: '2' },
    { id: '2', name: 'paused.bin', total: 0, done: 0, speed: 0, status: '3' },
    { id: '3', name: 'done.bin', total: 10, done: 10, speed: 0, status: '4' },
    { id: '4', name: 'bad.bin', total: 10, done: 1, speed: 0, status: '5' },
  ]);
  const lines = out.split('\n');
  assert.equal(lines.length, 5);
  assert.ok(out.includes('50%'));
  for (const s of ['传输中', '已暂停', '已完成', '已失败']) assert.ok(out.includes(s));
  assert.ok(!out.includes('NaN') && !out.includes('Infinity'));
  assert.ok(lines[1].length <= 120, '长文件名应截断');
});

test('renderTaskPanel 长 ID 不与文件名、进度与速度粘连', () => {
  const line = renderTaskPanel([{ id: '1793793194', name: 'x.bin', total: 100, done: 22, speed: 2e7, status: '2' }]).split('\n')[1];
  assert.match(line, /^1793793194\s{2}x\.bin/);
  assert.match(line, /22%\s+\S+ \S+\s+传输中/);
});

test('buildTaskActionPayload 生成官方 (cid, isDownload, idsJson)', () => {
  assert.deepEqual(buildTaskActionPayload(true, [1, 2]), ['0', true, '["1","2"]']);
  assert.deepEqual(buildTaskActionPayload(false, [3]), ['0', false, '["3"]']);
});

test('summarizeEnd 取出 end 事件中的失败任务', () => {
  const ok = { end: [{ task: { ...RAW, status: '4' }, meta: '' }] };
  const bad = { end: [{ task: { ...RAW, status: '5', error: '31066' }, meta: '' }] };
  assert.deepEqual(summarizeEnd(ok), { ids: ['7'], finished: 1, failures: [] });
  assert.deepEqual(summarizeEnd(bad), { ids: ['7'], finished: 1, failures: [{ name: 'b.bin', error: 31066 }] });
});

test('isSettled 仅在没有运行/等待中的任务时为真', () => {
  assert.equal(isSettled([]), true);
  assert.equal(isSettled([{ status: '2' }]), false);
  assert.equal(isSettled([{ status: '1' }]), false);
  assert.equal(isSettled([{ status: '5' }, { status: '3' }]), true);
});

test('isFinished 暂停的任务不算结束,失败或清空才算', () => {
  assert.equal(isFinished([]), true);
  assert.equal(isFinished([{ status: '5' }]), true);
  assert.equal(isFinished([{ status: '3' }]), false);
  assert.equal(isFinished([{ status: '2' }]), false);
});

const captureLog = async (fn) => {
  const lines = [];
  const orig = console.log;
  console.log = (s) => lines.push(String(s));
  try { await fn(); } finally { console.log = orig; }
  return lines;
};

test('runTransfer 单发模式阻塞到完成,失败时抛错', async () => {
  const ctx = { api: {}, repl: false };
  const lines = await captureLog(() => runTransfer(ctx, {
    isDownload: true, start() {}, doneMessage: '完成了', failPrefix: '下载失败',
    waitImpl: async () => ({ finished: 1, failures: [] }),
  }));
  assert.deepEqual(lines, ['完成了']);
  await assert.rejects(runTransfer(ctx, {
    isDownload: true, start() {}, doneMessage: 'x', failPrefix: '下载失败',
    waitImpl: async () => ({ finished: 1, failures: [{ name: 'a', error: -9 }] }),
  }), /下载失败/);
});

test('runTransfer REPL 模式立刻返回,完成后通知并清除活动计数', async () => {
  const notes = [];
  const ctx = { api: {}, repl: true, notify: (m) => notes.push(m) };
  let finish;
  await captureLog(() => runTransfer(ctx, {
    isDownload: true, start() {}, doneMessage: '完成了', failPrefix: '下载失败',
    waitImpl: () => new Promise((r) => { finish = r; }),
  }));
  assert.equal(ctx.active, 1);
  assert.deepEqual(notes, []);
  finish({ finished: 1, failures: [] });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(notes, ['完成了']);
  assert.equal(ctx.active, 0);
});

test('runTransfer REPL 模式失败时通知而不是抛错', async () => {
  const notes = [];
  const ctx = { api: {}, repl: true, notify: (m) => notes.push(m) };
  await captureLog(() => runTransfer(ctx, {
    isDownload: true, start() {}, doneMessage: 'x', failPrefix: '下载失败',
    waitImpl: async () => { throw new Error('任务未能启动'); },
  }));
  await new Promise((r) => setImmediate(r));
  assert.ok(notes[0].includes('任务未能启动'));
  assert.equal(ctx.active, 0);
});

test('createTaskTracker 忽略没变化的旧失败和旧暂停任务', () => {
  const t = createTaskTracker(new Map([['1', '5'], ['2', '3']]));
  const items = [{ id: '1', status: '5' }, { id: '2', status: '3' }, { id: '3', status: '2' }];
  assert.deepEqual(t.select(items).map((x) => x.id), ['3']);
});

test('createTaskTracker 把重新运行的旧任务算作本次,失败后仍算', () => {
  const t = createTaskTracker(new Map([['1', '5']]));
  assert.deepEqual(t.select([{ id: '1', status: '2' }]).map((x) => x.id), ['1']);
  assert.deepEqual(t.select([{ id: '1', status: '5' }]).map((x) => x.id), ['1']);
});

test('createTaskTracker 收到 end 事件的任务算本次,即使轮询没看到状态变化', () => {
  const t = createTaskTracker(new Map([['1', '5']]));
  t.mark(['1']);
  assert.deepEqual(t.select([{ id: '1', status: '5' }]).map((x) => x.id), ['1']);
});

test('controlApplied 判断控制命令是否生效', () => {
  assert.equal(controlApplied('delete', ['1'], [{ id: '1', status: '5' }]), false);
  assert.equal(controlApplied('delete', ['1'], [{ id: '2', status: '5' }]), true);
  assert.equal(controlApplied('pause', ['1'], [{ id: '1', status: '2' }]), false);
  assert.equal(controlApplied('pause', ['1'], [{ id: '1', status: '3' }]), true);
  assert.equal(controlApplied('resume', ['1'], [{ id: '1', status: '3' }]), false);
  assert.equal(controlApplied('resume', ['1'], [{ id: '1', status: '1' }]), true);
  assert.equal(controlApplied('top', ['1'], []), true);
});
