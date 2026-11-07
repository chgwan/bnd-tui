// 远端路径上下文(REPL 的 cwd 与单发模式的路径解析)。

export function joinRemote(...parts) {
  const joined = parts.join('/').replace(/\/+/g, '/');
  return joined.startsWith('/') ? joined : `/${joined}`;
}

export function resolveRemote(cwd, arg) {
  const base = arg?.startsWith('/') ? '' : cwd;
  const combined = `${base}/${arg ?? ''}`.replace(/\/+/g, '/');
  const out = [];
  for (const seg of combined.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return `/${out.join('/')}`;
}
