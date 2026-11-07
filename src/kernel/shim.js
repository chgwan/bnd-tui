// 垫片要在进程启动时加载,所以由 bin/bnd.js 在 re-exec 时放进 LD_PRELOAD。
// 垫片必须排在最前:它启动时会摘掉第一项。
import { existsSync } from 'node:fs';

export function withShim(env, shimPath, exists = existsSync) {
  if (env.BND_NO_SHIM === '1' || !exists(shimPath)) return env;
  const preload = env.LD_PRELOAD ? `${shimPath}:${env.LD_PRELOAD}` : shimPath;
  return { ...env, LD_PRELOAD: preload };
}
