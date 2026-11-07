// 加载官方内核引擎 libbrowserengine.so(只读复用,永不修改)。
import koffi from 'koffi';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { OFFICIAL_DIR, OFFICIAL_DEPS } from './official.js';

export { OFFICIAL_DIR, OFFICIAL_DEPS };
export const DEFAULT_ENGINE_PATH = path.join(OFFICIAL_DIR, 'libbrowserengine.so');

/**
 * @param {{enginePath?: string}} opts
 * @returns {{lib: object, api: {get_version(): string}}}
 */
export function loadEngine({ enginePath = DEFAULT_ENGINE_PATH } = {}) {
  if (!existsSync(enginePath)) {
    throw new Error(
      `未找到内核引擎 ${enginePath}(libbrowserengine.so)——请确认官方客户端解包在 ~/opt/baidunetdisk,或用 BND_OFFICIAL_ROOT 指定`,
    );
  }
  const lib = koffi.load(enginePath);
  const api = {
    get_version: lib.func('browser_engine_get_version', 'string', []),
  };
  return { lib, api };
}
