// 生成单文件可执行 dist/bnd(Node SEA)。用法:npm run build
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildShim } from './build-shim.mjs';
import { INSTALLED_ROOT } from '../src/kernel/official.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const work = path.join(dist, '.sea');
const output = path.join(dist, 'bnd');
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

// 运行时用到的官方文件(实测 ls/上传/下载/rm/tasks/扫码登录只打开这些),约 94MB。
// 三个 asar(GUI 界面与播放器,约 320MB)和 Electron 主程序不需要。
const OFFICIAL_FILES = [
  'libbnusdk.so', 'libbrowserengine.so', 'libkernel.so', 'libminosagent.so', 'libplayer.so',
  'netdisk_service',
  'resources/cacert.pem', 'resources/default.db', 'resources/resource.db', 'resources/version',
].map((f) => `opt/baidunetdisk/${f}`);
const OFFICIAL_DIRS = ['deps/usr/lib64'];

function stageOfficial(src, dest) {
  for (const rel of [...OFFICIAL_FILES, ...OFFICIAL_DIRS]) {
    const from = path.join(src, rel);
    if (!fs.existsSync(from)) throw new Error(`缺少官方文件 ${from}:请先把官方 deb 解包到 ${src},或用 BND_OFFICIAL_ROOT 指定`);
    fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
    fs.cpSync(from, path.join(dest, rel), { recursive: true, verbatimSymlinks: true });
  }
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

buildShim();

stageOfficial(process.env.BND_OFFICIAL_ROOT || INSTALLED_ROOT, path.join(work, 'official'));

const archive = path.join(work, 'app.tar.gz');
run('tar', [
  '-czf', archive, 'package.json', 'bin', 'src', 'native/bnd-shim.so', 'scripts/sea-launch.cjs', 'node_modules',
  '-C', work, 'official',
]);

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
