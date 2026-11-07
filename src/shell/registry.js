// 命令注册表:REPL 与单发模式共用。

const REGISTRY = new Map();

export function registerCommand(name, def) {
  if (REGISTRY.has(name)) throw new Error(`重复注册命令:${name}`);
  REGISTRY.set(name, def);
  return def;
}

export function getCommand(name) {
  return REGISTRY.get(name);
}

export function commandNames() {
  return [...REGISTRY.keys()];
}

export function makeCtx(extra = {}) {
  return { cwd: '/', repl: false, ...extra };
}
