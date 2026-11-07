// 单文件可执行的入口。koffi 的 .node 和 playwright 都要真实文件路径,
// 所以把应用整体打成资产,首次运行解压到缓存目录,之后走与源码相同的代码路径。
const { getAsset } = require('node:sea');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function ensureApp() {
  const root = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'bnd-tui');
  const dir = path.join(root, `app-${getAsset('id', 'utf8')}`);
  if (fs.existsSync(dir)) return dir;

  fs.mkdirSync(root, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(root, '.extract-'));
  try {
    const archive = path.join(tmp, 'app.tar.gz');
    fs.writeFileSync(archive, Buffer.from(getAsset('app.tar.gz')));
    const tar = spawnSync('tar', ['-xzf', archive, '-C', tmp], { stdio: 'inherit' });
    if (tar.status !== 0) throw new Error('解压 bnd 运行文件失败(需要系统 tar 命令)');
    fs.rmSync(archive);
    try {
      fs.renameSync(tmp, dir);
    } catch (e) {
      // 并发启动时对方已解压完成,用它的即可
      if (!fs.existsSync(dir)) throw e;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return dir;
}

try {
  const dir = ensureApp();
  process.argv = [process.execPath, path.join(dir, 'bin/bnd.js'), ...process.argv.slice(2)];
  createRequire(path.join(dir, 'scripts/'))('./sea-launch.cjs');
} catch (e) {
  console.error(e && e.message ? e.message : String(e));
  process.exit(1);
}
