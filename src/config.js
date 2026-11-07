// bnd 自身配置(区别于内核/官方客户端状态):~/.config/bnd-tui/config.json,0600。
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = process.env.BND_HOME ?? os.homedir();
export const CONFIG_DIR = path.join(HOME, '.config', 'bnd-tui');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  download_dir: path.join(HOME, 'Downloads', 'bnd'),
  max_parallel: 3,
  p2p_mode: 2, // 官方枚举:0=DISABLE_UPLOAD, 2=SPEEDUP
};

export function loadConfig() {
  let stored = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      stored = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
      stored = {}; // 损坏配置回退默认值
    }
  }
  const cfg = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (key in stored) cfg[key] = stored[key];
  }
  return cfg;
}

export function saveConfig(patch) {
  const cfg = { ...loadConfig() };
  for (const key of Object.keys(DEFAULTS)) {
    if (key in patch) cfg[key] = patch[key];
  }
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  chmodSync(CONFIG_PATH, 0o600); // 已存在文件时 writeFileSync 的 mode 不生效
  return cfg;
}
