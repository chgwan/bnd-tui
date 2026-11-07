// 命令分发:单发 `bnd <cmd>` 与交互 REPL 共用注册表;内核命令统一走 init/uninit 生命周期。
import { exitProcess, initKernel, uninitKernel, isKernelUp } from './kernel/init.js';
import { ensureDisplay } from './kernel/display.js';
import { loadCreds, applyLogin } from './auth/state.js';
import { registerCommand, getCommand, commandNames, makeCtx } from './shell/registry.js';

let exiting = false;
function onSignal() {
  if (exiting) return;
  exiting = true;
  if (isKernelUp()) {
    uninitKernel().then(() => exitProcess(130)); // 传输中 Ctrl-C 也走干净 uninit
  } else {
    process.exit(130);
  }
}

// 内核启动时用自己的处理器覆盖 SIGINT/SIGTERM,此后 Node 收不到信号,传输无法中断。
// 内核起来后要再调一次:摘掉最后一个监听器时 libuv 才会重新 sigaction。
function installSignalHandlers() {
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.off(sig, onSignal);
    process.on(sig, onSignal);
  }
}

async function registerAll() {
  registerCommand('version', { kernel: true, run: async (ctx) => { console.log(ctx.api.browser_engine_get_version()); } });
  registerCommand('login', { kernel: true, load: async () => (await import('./shell/commands/login.js')).run });
  registerCommand('logout', { kernel: true, load: async () => (await import('./shell/commands/logout.js')).run });
  registerCommand('whoami', { kernel: true, load: async () => (await import('./shell/commands/whoami.js')).run });
  registerCommand('ls', { kernel: true, load: async () => (await import('./shell/commands/ls.js')).run });
  registerCommand('cd', { kernel: false, load: async () => (await import('./shell/commands/cd.js')).run });
  registerCommand('download', { kernel: true, load: async () => (await import('./shell/commands/download.js')).run });
  registerCommand('upload', { kernel: true, load: async () => (await import('./shell/commands/upload.js')).run });
  registerCommand('rm', { kernel: true, load: async () => (await import('./shell/commands/rm.js')).run });
  registerCommand('tasks', { kernel: true, load: async () => (await import('./shell/commands/tasks.js')).run });
  registerCommand('help', {
    kernel: false,
    run: async () => { console.log(`可用命令:${commandNames().join('、')}`); },
  });
  registerCommand('exit', {
    kernel: false,
    run: async () => {
      if (isKernelUp()) await uninitKernel();
      exitProcess(0);
    },
  });
}

async function ensureKernel(ctx, coexist, { needLogin = true } = {}) {
  await ensureDisplay();
  const { api, events } = initKernel({ coexist });
  ctx.api = api;
  ctx.events = events;
  if (needLogin) {
    const creds = loadCreds();
    if (creds) applyLogin(api, creds);
  }
  installSignalHandlers();
}

export async function main(argv) {
  const coexist = argv.includes('--coexist');
  const positional = argv.filter((a) => a !== '--coexist');
  installSignalHandlers();
  await registerAll();

  // REPL 模式:无位置参数
  if (positional.length === 0) {
    const { startRepl } = await import('./shell/repl.js');
    const ctx = makeCtx();
    const dispatch = async (c, parts) => {
      const [name, ...args] = parts;
      const def = getCommand(name);
      if (!def) throw new Error(`未知命令:${name}(help 查看)`);
      const run = def.load ? await def.load() : def.run;
      if (def.kernel && !c.api) await ensureKernel(c, coexist);
      await run(c, args);
    };
    // REPL 首条内核命令才 init;结束后由 bin 走统一退出
    await startRepl(ctx, dispatch);
    if (isKernelUp()) await uninitKernel();
    return 0;
  }

  const [cmd, ...args] = positional;
  const def = getCommand(cmd);
  if (!def) {
    console.error(`未知命令:${cmd}(可用:${commandNames().join('、')})`);
    return 1;
  }
  const run = def.load ? await def.load() : def.run;
  const ctx = makeCtx();
  if (def.kernel) {
    try {
      await ensureKernel(ctx, coexist, { needLogin: cmd !== 'login' });
    } catch (e) {
      console.error(e?.message ?? String(e));
      return 1;
    }
  }
  try {
    await run(ctx, args);
  } catch (e) {
    console.error(e?.message ?? String(e));
    return 1;
  } finally {
    if (isKernelUp()) await uninitKernel();
  }
  return 0;
}
