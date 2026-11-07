// bnd tasks [--watch] | pause/resume/delete/top <id...> [--upload]
// 官方现场(isDownload:下载 true、上传 false):
//   get_task_items(cid="0", isDownload, parentId, 0, count, cb, outCookie)
//   set_task_callback(isDownload, TaskStart*, TaskProgress*, TaskEnd*, CmdChange*, CmdError*)
//   pause/enqueue_task(cid, isDownload, idsJson)、delete_task(cid, isDownload, idsJson, onlyCompleted)
import koffi from 'koffi';
import { PROTOS } from '../../kernel/glue.gen.js';
import { describeCode } from '../../kernel/errors.js';
import { formatSize, formatSpeed, renderBar } from '../../util/format.js';

const TASK_CB_REFS = new Set(); // 持有回调指针防 GC(事件总线同一约束)
// 官方 FILE_TRANS_TASK_*
const STATUS = { WAITING: '1', RUNNING: '2', PAUSED: '3', COMPLETE: '4', FAILED: '5' };
const PERSIST_MS = 1000;
const STATUS_ZH = { 0: '已删除', 1: '等待中', 2: '传输中', 3: '已暂停', 4: '已完成', 5: '已失败' };

export function parseTaskItem(raw = {}) {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? raw.server_path ?? '(未命名)'),
    total: Number(raw.size ?? 0),
    done: Number(raw.finish_size ?? 0),
    speed: Number(raw.rate ?? 0),
    status: String(raw.status ?? ''),
    error: Number(raw.error ?? 0),
  };
}

// 内核返回 {tasks:[…]};无任务时 tasks 是字符串
export function parseTaskList(json) {
  let parsed;
  try { parsed = JSON.parse(json || '{}'); } catch { return []; }
  return Array.isArray(parsed.tasks) ? parsed.tasks.map(parseTaskItem) : [];
}

export function summarizeEnd(event) {
  const tasks = (event.end ?? []).map((e) => parseTaskItem(e.task));
  return {
    ids: tasks.map((t) => t.id),
    finished: tasks.length,
    failures: tasks.filter((t) => t.status === STATUS.FAILED).map((t) => ({ name: t.name, error: t.error })),
  };
}

export function isSettled(items) {
  return !items.some((t) => t.status === STATUS.RUNNING || t.status === STATUS.WAITING);
}

// 传输是否结束:暂停的任务还会恢复,不算结束
export function isFinished(items) {
  return items.every((t) => t.status === STATUS.FAILED);
}

// 队列里可能有上次留下的失败或暂停任务,它们不属于本次传输。内核对同一文件会复用
// 旧任务,所以状态变过或收到过 end 事件的任务算本次的,之后一直算。
export function createTaskTracker(baseline) {
  const own = new Set();
  const isStale = (t) => baseline.get(t.id) === t.status && (t.status === STATUS.FAILED || t.status === STATUS.PAUSED);
  return {
    mark: (ids) => ids.forEach((id) => own.add(id)),
    select(items) {
      for (const t of items) if (!isStale(t)) own.add(t.id);
      return items.filter((t) => own.has(t.id));
    },
  };
}

// 控制命令是否已生效。内核异步执行,单发命令不等就退出会丢操作
export function controlApplied(action, ids, items) {
  const targets = items.filter((t) => ids.includes(t.id));
  if (action === 'delete') return targets.length === 0;
  if (action === 'pause') return targets.every((t) => t.status === STATUS.PAUSED);
  if (action === 'resume') return targets.every((t) => t.status !== STATUS.PAUSED);
  return true;
}

export function renderTaskPanel(items) {
  const idWidth = Math.max(2, ...items.map((t) => t.id.length));
  const row = (id, name, bar, speed, status) =>
    `${id.padEnd(idWidth)}  ${name.padEnd(40).slice(0, 40)}  ${bar.padEnd(24)}  ${speed.padStart(11)}  ${status}`;
  const lines = [row('ID', '名称', '进度', '速度', '状态')];
  for (const t of items) {
    const name = t.name.length > 40 ? t.name.slice(0, 39) + '…' : t.name;
    const speed = t.status === STATUS.RUNNING ? formatSpeed(t.speed) : '-';
    lines.push(row(t.id, name, renderBar(t.done, t.total, 18), speed, STATUS_ZH[t.status] ?? `状态${t.status}`));
  }
  return lines.join('\n');
}

export function buildTaskActionPayload(isDownload, ids = []) {
  return ['0', isDownload, JSON.stringify(ids.map(String))];
}

// 官方在构造时注册,方向由首参区分;每个方向只注册一次,须早于创建任务
const endListeners = { true: new Set(), false: new Set() };
const callbacksInstalled = new WeakMap(); // api → Set<isDownload>

function ensureTaskCallbacks(api, isDownload) {
  const done = callbacksInstalled.get(api) ?? new Set();
  callbacksInstalled.set(api, done);
  if (done.has(isDownload)) return;
  done.add(isDownload);
  const mk = (proto, fn) => {
    const ptr = koffi.register(fn, koffi.pointer(proto));
    TASK_CB_REFS.add(ptr);
    return ptr;
  };
  const end = (json) => {
    try {
      const event = JSON.parse(json || '{}');
      for (const fn of endListeners[isDownload]) fn(event);
    } catch { /* 回调绝不能抛回内核 */ }
  };
  api.browser_engine_set_task_callback(
    isDownload,
    mk(PROTOS.TaskStart, () => {}),
    mk(PROTOS.TaskProgress, () => {}),
    mk(PROTOS.TaskEnd, end),
    mk(PROTOS.CmdChange, () => {}),
    mk(PROTOS.CmdError, () => {}),
  );
}

export function fetchTaskItems(api, { isDownload = true, count = 100 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('获取任务列表超时')), 10000);
    const cbPtr = koffi.register((result, _cookie, json) => {
      clearTimeout(timer);
      setImmediate(() => {
        if (result !== 0) reject(new Error(`获取任务列表失败:${describeCode(result)}`));
        else resolve(parseTaskList(json));
      });
    }, koffi.pointer(PROTOS.GetTaskItems));
    TASK_CB_REFS.add(cbPtr);
    const rc = api.browser_engine_get_task_items('0', isDownload, 0, 0, count, cbPtr, [0n]);
    if (rc !== 0) {
      clearTimeout(timer);
      reject(new Error(`获取任务列表失败:${describeCode(rc)}`));
    }
  });
}

// 传输运行在本进程的内核里,进程退出任务就停:必须等到全部结束
export async function startAndWait(api, { isDownload, start, quiet = false, pollMs = 1000, startTimeoutMs = 20000 }) {
  const failures = [];
  let finished = 0;
  let tracker = null;
  const onEnd = (event) => {
    const r = summarizeEnd(event);
    finished += r.finished;
    failures.push(...r.failures);
    tracker?.mark(r.ids);
  };
  ensureTaskCallbacks(api, isDownload);
  const showBar = !quiet && process.stderr.isTTY;
  await waitForRestore(api);
  const queued = await fetchTaskItems(api, { isDownload });
  tracker = createTaskTracker(new Map(queued.map((t) => [t.id, t.status])));
  endListeners[isDownload].add(onEnd);
  try {
    start();
    const startedAt = Date.now();
    let seen = false;
    for (;;) {
      await new Promise((r) => setTimeout(r, pollMs));
      const items = tracker.select(await fetchTaskItems(api, { isDownload }));
      if (items.length > 0) seen = true;
      if (showBar && items.length > 0) {
        const done = items.reduce((n, t) => n + t.done, 0);
        const total = items.reduce((n, t) => n + t.total, 0);
        const speed = items.reduce((n, t) => n + t.speed, 0);
        process.stderr.write(`\r\x1b[K${renderBar(done, total, 24)} ${formatSize(done)}/${formatSize(total)} ${formatSpeed(speed)}`);
      }
      if ((seen || finished > 0) && isFinished(items)) {
        if (showBar) process.stderr.write('\r\x1b[K');
        for (const t of items) if (!failures.some((f) => f.name === t.name)) failures.push({ name: t.name, error: t.error });
        return { finished, failures };
      }
      if (!seen && finished === 0 && Date.now() - startedAt > startTimeoutMs) throw new Error('任务未能启动(内核未返回任务)');
    }
  } finally {
    endListeners[isDownload].delete(onEnd);
  }
}

// 单发模式阻塞到完成;REPL 模式后台运行,期间可用 tasks 查看和控制
export async function runTransfer(ctx, { isDownload, start, doneMessage, failPrefix, waitImpl = startAndWait }) {
  const wait = waitImpl(ctx.api, { isDownload, start, quiet: ctx.repl });
  const report = ({ failures }) => {
    if (failures.length > 0) throw new Error(`${failPrefix}:${formatFailures(failures)}`);
    return doneMessage;
  };
  if (!ctx.repl) {
    console.log(report(await wait));
    return;
  }
  ctx.active = (ctx.active ?? 0) + 1;
  console.log('已在后台开始。tasks 查看进度,tasks pause <ID> 暂停,tasks resume <ID> 恢复');
  wait.then(report)
    .then((msg) => ctx.notify(msg), (e) => ctx.notify(e.message))
    .finally(() => { ctx.active -= 1; });
}

export function formatFailures(failures) {
  return failures.map((f) => `${f.name}:${describeCode(f.error)}`).join(';');
}

// 内核在登录后异步恢复上次未完成的任务,单发命令要等它加载完才看得到
let restored = false;
async function waitForRestore(api, { timeoutMs = 3000, pollMs = 500 } = {}) {
  if (restored) return;
  restored = true;
  for (let waited = 0; waited < timeoutMs; waited += pollMs) {
    const dl = await fetchTaskItems(api, { isDownload: true });
    const up = await fetchTaskItems(api, { isDownload: false });
    if (dl.length + up.length > 0) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

async function waitForControl(api, { action, isDownload, ids, timeoutMs = 5000, pollMs = 200 }) {
  for (let waited = 0; waited < timeoutMs; waited += pollMs) {
    if (controlApplied(action, ids, await fetchTaskItems(api, { isDownload }))) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`${action} 未生效:内核 ${timeoutMs / 1000} 秒内没有完成`);
}

export async function run(ctx, args) {
  await waitForRestore(ctx.api);
  const isDownload = !args.includes('--upload');
  const rest = args.filter((a) => a !== '--upload');
  const [action, ...idArgs] = rest;
  const controls = {
    pause: (a, ...p) => a.browser_engine_pause_task(...p),
    resume: (a, ...p) => a.browser_engine_enqueue_task(...p),
    delete: (a, ...p) => a.browser_engine_delete_task(...p, false),
    top: (a, cid, _dir, ids) => a.browser_engine_top_task(cid, true, ids),
  };
  if (action in controls) {
    const ids = idArgs.filter((n) => /^\d+$/.test(n));
    if (ids.length === 0) throw new Error(`用法:bnd tasks ${action} <任务ID...> [--upload]`);
    const queued = await fetchTaskItems(ctx.api, { isDownload });
    const missing = ids.filter((id) => !queued.some((t) => t.id === id));
    if (missing.length > 0) throw new Error(`任务不存在:${missing.join(', ')}`);
    const rc = controls[action](ctx.api, ...buildTaskActionPayload(isDownload, ids));
    if (rc !== 0) throw new Error(`${action} 失败:${describeCode(rc)}`);
    await waitForControl(ctx.api, { action, isDownload, ids });
    // 列表先变、落盘在后,单发命令马上退出的话下次启动任务又会回来
    if (!ctx.repl) await new Promise((r) => setTimeout(r, PERSIST_MS));
    console.log(`已执行 ${action}:${ids.join(', ')}`);
    return;
  }

  const watch = args.includes('--watch');
  const render = async () => {
    const dl = await fetchTaskItems(ctx.api, { isDownload: true });
    const up = await fetchTaskItems(ctx.api, { isDownload: false });
    const out = `下载\n${renderTaskPanel(dl)}\n\n上传\n${renderTaskPanel(up)}`;
    if (watch) process.stdout.write(`\x1b[2J\x1b[H${out}\n`);
    else console.log(out);
  };
  if (!watch) {
    await render();
    return;
  }
  // --watch:500ms 刷新,无运行中的任务时结束
  for (;;) {
    await render();
    const dl = await fetchTaskItems(ctx.api, { isDownload: true });
    const up = await fetchTaskItems(ctx.api, { isDownload: false });
    if (isSettled([...dl, ...up])) return; // 无运行中的任务时结束,否则 REPL 会一直卡住
    await new Promise((r) => setTimeout(r, 500));
  }
}
