// 事件总线:注册 InternalLog / CommonEvent 两个内核回调并分发事件。
// 关键约束:koffi 注册的回调指针必须被模块级引用持有到进程退出,
// 否则 V8 GC 回收后内核回调进已释放内存会导致崩溃(Review Focus #2)。
import koffi from 'koffi';
import { PROTOS } from './glue.gen.js';

function defaultOnLog(level, msg) {
  if (Number(level) >= 4) console.error(`[kernel] ${msg}`);
}

export function initEventBus({ onLog = defaultOnLog } = {}) {
  const handlers = new Map(); // matcher('*' | eventId) -> Set<fn>
  const callbackRefs = new Map(); // 永驻持有,防 GC

  function onEvent(matcher, fn) {
    const key = typeof matcher === 'number' ? matcher : String(matcher);
    if (!handlers.has(key)) handlers.set(key, new Set());
    handlers.get(key).add(fn);
    return () => handlers.get(key)?.delete(fn);
  }

  function dispatch(eventId, json, extra) {
    let payload = json;
    if (typeof json === 'string' && json.length > 0) {
      try {
        payload = JSON.parse(json);
      } catch {
        payload = json;
      }
    }
    for (const fn of handlers.get(eventId) ?? []) {
      try {
        fn(payload, extra, eventId);
      } catch (e) {
        console.error(`[events] 事件 ${eventId} 处理器异常: ${e.message}`);
      }
    }
    for (const fn of handlers.get('*') ?? []) {
      try {
        fn(payload, extra, eventId);
      } catch (e) {
        console.error(`[events] 通配处理器异常: ${e.message}`);
      }
    }
  }

  function handleInternalLog(level, msg) {
    try {
      onLog(Number(level), String(msg ?? ''));
    } catch {
      // 日志回调绝不允许抛出
    }
  }

  // koffi.register 需要回调的“指针类型”(官方 JS 写作 "browserEngineXxxCallback *")
  const internalLog = koffi.register(handleInternalLog, koffi.pointer(PROTOS.InternalLog));
  const commonEvent = koffi.register((id, json, extra) => dispatch(id, json, extra), koffi.pointer(PROTOS.CommonEvent));
  callbackRefs.set('internalLog', internalLog);
  callbackRefs.set('commonEvent', commonEvent);

  return {
    dispatch,
    onEvent,
    handleInternalLog,
    callbackRefs,
    pointers: { internalLog, commonEvent },
  };
}
