// 生成单文件可执行 dist/bnd(Node SEA)。用法:npm run build
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildShim } from './build-shim.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const work = path.join(dist, '.sea');
const output = path.join(dist, 'bnd');
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

buildShim();

const archive = path.join(work, 'app.tar.gz');
run('tar', ['-czf', archive, 'package.json', 'bin', 'src', 'native/bnd-shim.so', 'scripts/sea-launch.cjs', 'node_modules']);

const id = path.join(work, 'id');
fs.writeFileSync(id, createHash('sha256').update(fs.readFileSync(archive)).digest('hex').slice(0, 16));

const blob = path.join(work, 'bnd.blob');
const config = path.join(work, 'sea-config.json');
fs.writeFileSync(config, JSON.stringify({
  main: path.join(root, 'scripts/sea-entry.cjs'),
  output: blob,
  disableExperimentalSEAWarning: true,
  assets: { 'app.tar.gz': archive, id },
}));
run(process.execPath, ['--experimental-sea-config', config]);

fs.rmSync(output, { force: true });
fs.copyFileSync(process.execPath, output);
run('npx', ['--yes', 'postject@1.0.0-alpha.6', output, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', SENTINEL]);
fs.rmSync(work, { recursive: true, force: true });

console.log(`已生成 ${output}(${(fs.statSync(output).size / 2 ** 20).toFixed(0)} MB)`);
