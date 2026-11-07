// 官方内核文件的位置。优先级:
// 1. 环境变量 BND_OFFICIAL_ROOT
// 2. 随单文件可执行附带的 official/(npm run build 从本机官方客户端拷入)
// 3. 解包的官方客户端 ~/opt/baidunetdisk
// 目录结构与官方 deb 解包后一致:opt/baidunetdisk/ 放内核,deps/usr/lib64/ 放运行库。
// 不依赖 koffi,bin/bnd.js 在 re-exec 前就要用。
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUNDLED_ROOT = fileURLToPath(new URL('../../official', import.meta.url));
export const INSTALLED_ROOT = path.join(homedir(), 'opt/baidunetdisk');

export function officialRoot(env = process.env, exists = existsSync) {
  if (env.BND_OFFICIAL_ROOT) return env.BND_OFFICIAL_ROOT;
  if (exists(path.join(BUNDLED_ROOT, 'opt/baidunetdisk/libbrowserengine.so'))) return BUNDLED_ROOT;
  return INSTALLED_ROOT;
}

export const OFFICIAL_ROOT = officialRoot();
export const OFFICIAL_DIR = path.join(OFFICIAL_ROOT, 'opt/baidunetdisk');
export const OFFICIAL_DEPS = path.join(OFFICIAL_ROOT, 'deps/usr/lib64');
