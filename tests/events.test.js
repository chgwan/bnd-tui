import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initEventBus } from '../src/kernel/events.js';

test('dispatch 按事件 id 分发已解析 JSON 与 extra', () => {
  const bus = initEventBus();
  let got;
  bus.onEvent(58, (payload, extra) => { got = { payload, extra }; });
  bus.dispatch(58, '{"status":"0","text":"百度网盘"}', 37);
  assert.deepEqual(got, { payload: { status: '0', text: '百度网盘' }, extra: 37 });
});

test('dispatch 非法 JSON 时以原始字符串传递', () => {
  const bus = initEventBus();
  let raw;
  bus.onEvent(99, (p) => { raw = p; });
  bus.dispatch(99, 'not-json', 1);
  assert.equal(raw, 'not-json');
});

test("onEvent('*') 收到所有事件及其 id", () => {
  const bus = initEventBus();
  let anyId;
  bus.onEvent('*', (payload, extra, id) => { anyId = id; });
  bus.dispatch(7, '{}', 0);
  assert.equal(anyId, 7);
});

test('initEventBus 持有全部回调引用且提供可传 FFI 的指针', () => {
  const bus = initEventBus();
  assert.ok(bus.callbackRefs.size >= 2, '回调注册表必须持有 InternalLog 与 CommonEvent');
  assert.ok(bus.pointers.internalLog, '缺少 internalLog 指针');
  assert.ok(bus.pointers.commonEvent, '缺少 commonEvent 指针');
});

test('内部日志转发给 onLog', () => {
  const logs = [];
  const bus = initEventBus({ onLog: (level, msg) => logs.push([level, msg]) });
  bus.handleInternalLog(2, 'hello kernel');
  assert.deepEqual(logs, [[2, 'hello kernel']]);
});
