// 终端二维码渲染:RGBA 像素 → 半块字符(▀▄█ ),两行像素合成一行字符。
// 两种入口:renderQrPixels(逐像素)与 renderQrModules(先测模块栅距,按模块渲染,可任意放大)。

function makeLum(data) {
  return (i) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

export function renderQrPixels(data, width, height, { threshold = 128, scale = 1, quiet = 0 } = {}) {
  const lum = makeLum(data);
  const origDark = (x, y) => lum((y * width + x) * 4) < threshold;
  const dark = (x, y) => {
    const mx = Math.floor(x / scale) - quiet;
    const my = Math.floor(y / scale) - quiet;
    if (mx < 0 || my < 0 || mx >= width || my >= height) return false; // 白边/越界
    return origDark(mx, my);
  };
  const effW = (width + 2 * quiet) * scale;
  const effH = (height + 2 * quiet) * scale;
  return paintCharGrid(dark, effW, effH);
}

// 测二维码模块栅距:扫描若干行/列,最短同色游程即一个模块的像素宽
export function detectModulePitch(data, width, height, { threshold = 128 } = {}) {
  const lum = makeLum(data);
  const darkAt = (x, y) => lum(((y * width + x) << 2)) < threshold;
  let min = Infinity;
  const scanLines = [
    ...[0.3, 0.5, 0.7].map((f) => ['h', Math.floor(height * f)]),
    ...[0.3, 0.5, 0.7].map((f) => ['v', Math.floor(width * f)]),
  ];
  for (const [dir, line] of scanLines) {
    const len = dir === 'h' ? width : height;
    const at = (i) => (dir === 'h' ? darkAt(i, line) : darkAt(line, i));
    let runStart = 0;
    for (let i = 1; i <= len; i++) {
      const a = at(i - 1);
      const b = i < len ? at(i) : !a;
      if (a !== b) {
        const run = i - runStart;
        if (run > 0 && run < min) min = run;
        runStart = i;
      }
    }
  }
  return min === Infinity ? 0 : min;
}

// 按模块渲染:每模块 scale×scale 字符,四周 quiet 模块白边;在模块中心采样,容忍非整数栅距
export function renderQrModules(data, width, height, { threshold = 128, scale = 2, quiet = 2 } = {}) {
  const pitch = detectModulePitch(data, width, height, { threshold });
  if (!pitch || pitch < 1) return renderQrPixels(data, width, height, { threshold, scale: 1, quiet });
  const cols = Math.floor(width / pitch);
  const rows = Math.floor(height / pitch);
  if (cols < 21 || rows < 21) return renderQrPixels(data, width, height, { threshold, scale: 1, quiet });

  const lum = makeLum(data);
  const moduleDark = (mx, my) => {
    // 在模块单元格中心采样(mx/my 含 quiet 偏移)
    const cx = Math.floor((mx - quiet + 0.5) * pitch);
    const cy = Math.floor((my - quiet + 0.5) * pitch);
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) return false;
    return lum(((cy * width + cx) << 2)) < threshold;
  };
  const effW = (cols + 2 * quiet) * scale;
  const effH = (rows + 2 * quiet) * scale;
  const dark = (x, y) => moduleDark(Math.floor(x / scale), Math.floor(y / scale));
  return paintCharGrid(dark, effW, effH);
}

function paintCharGrid(dark, effW, effH) {
  const lines = [];
  for (let y = 0; y < effH; y += 2) {
    let line = '';
    for (let x = 0; x < effW; x++) {
      const top = dark(x, y);
      const bottom = dark(x, y + 1);
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    lines.push(line); // 保留尾部空白:二维码模块对齐优先于行尾整洁
  }
  return lines.join('\n');
}
