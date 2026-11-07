// 交互式 shell:bnd> 提示符、历史、Tab 补全;内核只 init 一次。
import readline from 'node:readline';
import { commandNames } from './registry.js';

// 传输在本进程内运行,退出会中断:有任务时先提醒一次
export function confirmExit(ctx) {
  if (!ctx.active || ctx.exitWarned) return true;
  ctx.exitWarned = true;
  console.log(`还有 ${ctx.active} 个传输进行中,退出会中断它们。再次输入 exit 确认退出`);
  return false;
}

export async function startRepl(ctx, dispatch) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'bnd> ',
    completer: (line) => {
      const parts = line.split(/\s+/);
      if (parts.length <= 1) {
        const hits = commandNames().filter((c) => c.startsWith(parts[0] ?? ''));
        return [hits.length ? hits : commandNames(), line];
      }
      return [[], line];
    },
  });
  ctx.repl = true;
  ctx.notify = (msg) => {
    console.log(`\n${msg}`);
    if (!rl.closed) rl.prompt(true);
  };
  console.log('bnd 交互模式(输入命令;exit 退出,Tab 补全)');
  rl.prompt();
  // 逐行顺序执行:内核调用不能并发,且返回时调用方才进入退出流程
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === 'exit' || trimmed === 'quit') {
      if (confirmExit(ctx)) break;
    } else if (trimmed) {
      try {
        await dispatch(ctx, trimmed.split(/\s+/));
      } catch (e) {
        console.error(e?.message ?? String(e));
      }
    }
    if (!rl.closed) rl.prompt(); // 管道输入时 stdin 可能已结束,剩余行仍会读完
  }
  rl.close();
  console.log('再见');
}
