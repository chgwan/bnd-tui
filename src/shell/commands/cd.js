// bnd cd <路径>:REPL 内切换远端 cwd(单发模式下仅校验)。
import { resolveRemote } from '../context.js';

export async function run(ctx, args) {
  const target = resolveRemote(ctx.cwd ?? '/', args[0] ?? '/');
  ctx.cwd = target;
  if (ctx.repl) console.log(target);
}
