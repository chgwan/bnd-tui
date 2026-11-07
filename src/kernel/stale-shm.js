// 清理 SQLite 残留锁。内核崩溃或被杀后,NFS 上 -shm 的 DMS 锁可能没人释放,此后
// 每次打开都报 SQLITE_PROTOCOL:任务库初始化失败,上传任务不再保存。
// 锁绑在 inode 上,-shm 只是可重建的索引,删掉后 SQLite 从 .db 和 -wal 重建。
import { closeSync, openSync, readdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import koffi from 'koffi';

export const KERNEL_DATA_DIR = path.join(homedir(), '.config/baidunetdisk');

const F_GETLK = 5;
const F_RDLCK = 0;
const F_UNLCK = 2;
const DMS_BYTE = 128; // SQLite 的 UNIX_SHM_DMS
const FLOCK_SIZE = 32; // x86_64 的 struct flock:short, short, off_t@8, off_t@16, pid_t@24

let fcntl = null;

export function isDmsLocked(file) {
  fcntl ??= koffi.load('libc.so.6').func('int fcntl(int fd, int cmd, ...)');
  const lock = Buffer.alloc(FLOCK_SIZE);
  lock.writeInt16LE(F_RDLCK, 0);
  lock.writeBigInt64LE(BigInt(DMS_BYTE), 8);
  lock.writeBigInt64LE(1n, 16);
  const fd = openSync(file, 'r');
  try {
    if (fcntl(fd, F_GETLK, 'void *', lock) !== 0) return false;
  } finally {
    closeSync(fd);
  }
  return lock.readInt16LE(0) !== F_UNLCK;
}

function shmFiles(root) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const e of entries.filter((d) => d.isDirectory())) {
    const dir = path.join(root, e.name);
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.db-shm')) files.push(path.join(dir, name));
    }
  }
  return files;
}

// 只能在确认没有其他客户端运行时调用:否则这把锁可能正被使用
export function clearStaleShm(root = KERNEL_DATA_DIR, { isLocked = isDmsLocked } = {}) {
  const removed = [];
  for (const file of shmFiles(root)) {
    try {
      if (!isLocked(file)) continue;
      unlinkSync(file);
      removed.push(path.basename(file));
    } catch {
      // 清不掉就保持原状,内核照常启动
    }
  }
  return removed;
}
