// 大小/速度/进度条格式化(纯函数)。

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function formatSize(bytes) {
  let n = Number(bytes) || 0;
  if (n <= 0) return '0 B';
  let i = 0;
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024;
    i++;
  }
  const digits = n >= 100 || i === 0 ? 0 : 1;
  return `${n.toFixed(digits)} ${UNITS[i]}`;
}

export function formatSpeed(bytesPerSecond) {
  return `${formatSize(bytesPerSecond)}/s`;
}

export function renderBar(current, total, width = 30) {
  const cur = Math.max(0, Number(current) || 0);
  const tot = Math.max(0, Number(total) || 0);
  const ratio = tot > 0 ? Math.min(1, cur / tot) : 0;
  const filled = Math.round(ratio * (width - 2));
  const pct = tot > 0 ? Math.round(ratio * 100) : 0;
  return `[${'#'.repeat(filled)}${'-'.repeat(width - 2 - filled)}] ${pct}%`;
}
