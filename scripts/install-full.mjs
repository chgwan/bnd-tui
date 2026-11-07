#!/usr/bin/env node
// full 安装形态:追加扫码登录组件(默认安装不含)。
//   npm run install:full
// 组件:playwright(无头浏览器)+ pngjs(PNG 解码)+ Chromium(下载到 ~/.cache/ms-playwright)。
// 全部 --no-save,不写入 package.json —— 基础安装保持轻量。
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const run = (cmd, opts = {}) => {
  console.log(`+ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
};

run('npm install --no-save playwright pngjs');

const cli = path.join('node_modules', 'playwright', 'cli.js');
if (!existsSync(cli)) {
  console.error('playwright 安装异常:未找到 cli.js');
  process.exit(1);
}
run(`node ${cli} install chromium`);

console.log('\nfull 安装完成:扫码登录已启用 —— 运行 node bin/bnd.js login 开始扫码。');
console.log('注意:重新执行 npm install 后如提示扫码组件缺失,请再跑一次 npm run install:full。');
