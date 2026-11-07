// 编译内核垫片 native/bnd-shim.so。用法:npm run build:shim
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const native = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../native');

export function buildShim() {
  execFileSync('gcc', [
    '-shared', '-fPIC', '-O2', '-Wall', '-Wextra',
    '-o', path.join(native, 'bnd-shim.so'), path.join(native, 'bnd-shim.c'), '-ldl',
  ], { stdio: 'inherit' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) buildShim();
