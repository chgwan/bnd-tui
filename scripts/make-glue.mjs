#!/usr/bin/env node
// 从官方客户端 core.asar 的 main.js 机械提取全部 koffi 声明,生成 src/kernel/glue.gen.js。
// deb 升级后重跑:node scripts/make-glue.mjs
import { readFileSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

const CORE_ASAR = path.join(homedir(), 'opt/baidunetdisk/opt/baidunetdisk/resources/core.asar');
const OUT = new URL('../src/kernel/glue.gen.js', import.meta.url).pathname;

// ---------- asar 读取(头部 4×uint32:4, blockSize, jsonSize+pickle, jsonLen) ----------
function readAsarText(asarPath, innerPath) {
  const fd = openSync(asarPath, 'r');
  try {
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, 16, 0);
    const blockSize = head.readUInt32LE(4);
    const jsonLen = head.readUInt32LE(12);
    const jsonBuf = Buffer.alloc(jsonLen);
    readSync(fd, jsonBuf, 0, jsonLen, 16);
    const tree = JSON.parse(jsonBuf.toString('utf8'));
    let node = tree;
    for (const part of innerPath.split('/')) node = node.files[part];
    if (!node || node.offset === undefined) throw new Error(`asar 内未找到 ${innerPath}`);
    const dataBase = 8 + blockSize;
    const buf = Buffer.alloc(node.size);
    readSync(fd, buf, 0, node.size, dataBase + Number(node.offset));
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

// ---------- 词法工具:括号配平与顶层逗号切分 ----------
function matchBracket(src, openIdx) {
  const open = src[openIdx];
  const close = open === '[' ? ']' : open === '(' ? ')' : open === '{' ? '}' : null;
  if (!close) return -1;
  let depth = 0, inStr = false, q = '';
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === q) inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = true; q = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}
function splitTopLevel(s) {
  const parts = [];
  let depth = 0, inStr = false, q = '', start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === q) inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = true; q = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { parts.push(s.slice(start, i)); start = i + 1; }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

// ---------- 提取 ----------
const src = readAsarText(CORE_ASAR, 'main.js');

// 通用调用解析:找到 `.method("Name",` 后,解析整个实参列表(名称, 返回类型, [参数])
function parseCall(src, method, namePattern) {
  const out = [];
  const re = new RegExp(`\\.${method}\\(("${namePattern}")`, 'g');
  let m;
  while ((m = re.exec(src))) {
    const openIdx = m.index + m[0].length - 1; // 位于 name 的引号上
    // 回退到完整实参列表的起始括号:从 m.index 起找第一个 '('
    const callOpen = src.indexOf('(', m.index);
    if (callOpen === -1) continue;
    const callClose = matchBracket(src, callOpen);
    if (callClose === -1) continue;
    const args = splitTopLevel(src.slice(callOpen + 1, callClose));
    if (args.length < 3) continue;
    const name = args[0].replace(/^"|"$/g, '');
    const ret = args[1];
    const arrTok = args[2];
    if (!arrTok.startsWith('[')) continue;
    const arrClose = matchBracket(arrTok, 0);
    if (arrClose === -1) continue;
    out.push({ name, ret, argTokens: splitTopLevel(arrTok.slice(1, arrClose)) });
  }
  return out;
}

// proto 声明(全文件)
const protos = new Map();
for (const p of parseCall(src, 'proto', '[A-Za-z0-9_]+')) protos.set(p.name, p);
function protoKey(name) {
  let k = name.replace(/^browserEngine/, '').replace(/^BrowserEngine/, '').replace(/Callback$/, '');
  if (!k) k = name;
  return k;
}

// 函数声明模块区域(用于限定变量作用域):从 firstFunc 向前找最近的 webpack 模块边界
const firstFunc = src.indexOf('.func("browser_engine_');
let last = firstFunc;
{
  const re = /\.func\("browser_engine_/g;
  let m;
  while ((m = re.exec(src))) last = m.index;
}
let moduleStart = 0;
{
  const probe = src.slice(0, firstFunc);
  let tmp;
  const re2 = /(?:^|,)(\d+):function\(/g;
  while ((tmp = re2.exec(probe))) moduleStart = tmp.index;
}
const region = src.slice(moduleStart, last + 5000);

// 区域内 变量 -> proto 名(限声明模块作用域)
const varToProto = new Map();
{
  const re = /([\w$]+)\s*=\s*a\.a\.proto\("([A-Za-z0-9_]+)"/g;
  let m;
  while ((m = re.exec(region))) varToProto.set(m[1], m[2]);
}

// 区域内 变量 -> 字符串常量(仅信任 koffi 原始类型名,过滤无关字符串噪音)
const PRIMITIVE_TYPES = new Set(['string', 'uint32', 'int32', 'int64', 'uint64', 'bool', 'void', 'double', 'float', 'int8', 'uint8', 'int16', 'uint16']);
const varToConst = new Map();
{
  const re = /(?:^|[,;({])([\w$]+)=("(?:[^"\\]|\\.)*")/g;
  let m;
  while ((m = re.exec(region))) {
    const v = m[2].replace(/^"|"$/g, '');
    if (PRIMITIVE_TYPES.has(v)) varToConst.set(m[1], v);
  }
}

// 区域内 变量 -> disposable 类型(官方:c = a.a.disposable("FreeStr","string", Xn),Xn 调 browser_engine_free)
const varToDisposable = new Map();
{
  const re = /([\w$]+)=a\.a\.disposable\("([A-Za-z0-9_]+)","([^"]+)"/g;
  let m;
  while ((m = re.exec(region))) varToDisposable.set(m[1], m[2]);
}

// 参数 token → koffi 表达式
let unresolvedPointers = 0;
function typeExpr(token) {
  const t = token.trim();
  if (/^["']/.test(t)) return t.replace(/^['"]|['"]$/g, "'");
  const inout = t.match(/^a\.a\.inout\("([^"]*)\*"\)$/);
  if (inout) return `koffi.inout(koffi.pointer('${inout[1]}'))`;
  // 返回值为 inout string 的回调(PlayerBuf 等)降级为 'string',仅影响从不注册的媒体回调
  if (/^a\.a\.inout\("string"\)$/.test(t)) return `'string'`;
  if (varToDisposable.has(t)) return varToDisposable.get(t);
  if (varToConst.has(t)) return varToConst.get(t).replace(/^"|"$/g, "'");
  return `'${t.replace(/'/g, '')}'`;
}
function argExpr(token) {
  let t = token.trim();
  const inout = t.match(/^a\.a\.inout\("([^"]*)\*"\)$/);
  if (inout) return `koffi.inout(koffi.pointer('${inout[1]}'))`;
  const ptr = t.match(/^a\.a\.pointer\(([^)]+)\)$/);
  if (ptr) {
    const target = ptr[1].trim();
    if (/^["']/.test(target)) {
      const inner = target.replace(/^['"]|['"]$/g, '').replace(/\*$/, '');
      return `koffi.pointer('${inner}')`;
    }
    const protoName = varToProto.get(target);
    if (protoName) return `koffi.pointer(PROTOS[${JSON.stringify(protoKey(protoName))}])`;
    unresolvedPointers++;
    return `koffi.pointer('void')`;
  }
  if (/^["']/.test(t)) return t.replace(/^['"]|['"]$/g, "'");
  if (/^(true|false|\d+)$/.test(t)) return t;
  if (varToDisposable.has(t)) return varToDisposable.get(t);
  if (varToConst.has(t)) return varToConst.get(t).replace(/^"|"$/g, "'");
  // 其余为官方 JS 里的类型变量(匿名 struct 等)——这些函数 MVP 不调用,以指针大小兜底
  unresolvedPointers++;
  return `koffi.pointer('void')`;
}

// 函数声明:官方 main.js 里 324 个 .func("browser_engine_…","ret",[args])
const funcs = new Map();
for (const f of parseCall(src, 'func', 'browser_engine_[a-z0-9_]+')) funcs.set(f.name, f);

// ---------- 生成 ----------
const protoLines = [...protos.entries()]
  .map(([name, p]) => `  ${JSON.stringify(protoKey(name))}: koffi.proto(${JSON.stringify(name)}, ${typeExpr(p.ret)}, [${p.argTokens.map(argExpr).join(', ')}]),`)
  .join('\n');

const funcLines = [...funcs.entries()]
  .map(([name, f]) => `    ${JSON.stringify(name)}: lib.func(${JSON.stringify(name)}, ${typeExpr(f.ret)}, [${f.argTokens.map(argExpr).join(', ')}]),`)
  .join('\n');

const banner = `// 由 scripts/make-glue.mjs 从官方 core.asar(main.js)自动生成 —— 勿手改。
// 引擎版本源:~/${path.relative(homedir(), CORE_ASAR)}
// 统计:函数 ${funcs.size} 个,回调原型 ${protos.size} 个,disposable ${varToDisposable.size} 个,未解析指针参数 ${unresolvedPointers} 个(以 void* 兜底)。
// 重新生成:npm run glue
import koffi from 'koffi';

export const PROTOS = {
${protoLines}
};

export function declareAll(lib) {
  // 官方:c = koffi.disposable("FreeStr","string", e => browser_engine_free(e))
  const browser_engine_free = lib.func('browser_engine_free', 'uint32', ['string']);
${[...new Set([...varToDisposable.values()])].map((n) => `  const ${n} = koffi.disposable('${n}', 'string', browser_engine_free);`).join('\n')}
  return {
${funcLines}
  };
}
`;

writeFileSync(OUT, banner);
console.error(`glue.gen.js: ${funcs.size} funcs, ${protos.size} protos, ${unresolvedPointers} unresolved pointer args -> ${OUT}`);
