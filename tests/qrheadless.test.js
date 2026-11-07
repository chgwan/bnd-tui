import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderQrPixels } from '../src/auth/qrterminal.js';
import { chooseLoginMode } from '../src/auth/qrheadless.js';

function rgba(pixels) {
  // pixels: 二维数组,1=黑模块,0=白模块 → RGBA
  const h = pixels.length, w = pixels[0].length;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = pixels[y][x] ? 0 : 255; // 1=黑
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

test('renderQrPixels 用半块字符渲染,高度减半,黑模块产生笔画', () => {
  const { data, width, height } = rgba([
    [1],
    [0],
  ]);
  const out = renderQrPixels(data, width, height);
  const lines = out.split('\n');
  assert.equal(lines.length, 1); // 2 行像素 → 1 行字符
  assert.ok(lines[0].includes('▀'), `上黑下白应含 ▀:${lines[0]}`);
});

test('renderQrPixels 全黑/全白/交替', () => {
  assert.equal(renderQrPixels(rgba([[1], [1]]).data, 1, 2), '█');
  assert.equal(renderQrPixels(rgba([[0], [0]]).data, 1, 2), ' ');
  assert.equal(renderQrPixels(rgba([[0], [1]]).data, 1, 2), '▄');
});

test('renderQrPixels 奇数高度补空行不崩溃', () => {
  const out = renderQrPixels(rgba([[1, 1, 1]]).data, 2, 3);
  assert.ok(out.length > 0);
});

test('renderQrPixels scale=2 每模块放大为 2×2 字符并加白边', () => {
  const { data, width, height } = rgba([[1]]);
  const lines = renderQrPixels(data, width, height, { scale: 2, quiet: 1 }).split('\n');
  // 有效尺寸 = (1 + 2×1) × 2 = 6 字符宽,(1 + 2) × 2 = 6 像素行 → 3 行
  assert.equal(lines.length, 3);
  assert.ok(lines.every((l) => l.length === 6), JSON.stringify(lines));
  assert.ok(lines[1].includes('█'), '中心应有墨');
  assert.ok(lines[0].trim() === '' && lines[2].trim() === '', '上下应有白边');
});

test('chooseLoginMode 按参数与安装形态决策', () => {
  assert.equal(chooseLoginMode(['--bduss', 'B', '--stoken', 'S'], false), 'bootstrap');
  assert.equal(chooseLoginMode([], true), 'qr');
  assert.equal(chooseLoginMode([], false), 'hint');
  assert.equal(chooseLoginMode(['--bduss', 'B'], true), 'bootstrap'); // 显式引导优先
});

test('detectModulePitch 从合成 QR 图中测出模块栅距', async () => {
  const { detectModulePitch } = await import('../src/auth/qrterminal.js');
  const { PNG } = await import('pngjs');
  // 合成 21×21 模块、每模块 4px(含 2px 白边)的图:总 25×25 模块位 = 100×100px
  const N = 21, P = 4, Q = 2;
  const size = (N + 2 * Q) * P;
  const png = new PNG({ width: size, height: size });
  const isDark = (mx, my) => (mx + my) % 2 === 0; // 棋盘格:游程恒为 1 模块
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / P) - Q, my = Math.floor(y / P) - Q;
      const v = mx >= 0 && my >= 0 && mx < N && my < N && isDark(mx, my) ? 0 : 255;
      const i = (size * y + x) << 2;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = v;
      png.data[i + 3] = 255;
    }
  }
  assert.equal(detectModulePitch(png.data, size, size), P);
});

test('renderQrModules 按模块渲染,21 模块 × scale2 + quiet1 = 46 字符宽', async () => {
  const { renderQrModules } = await import('../src/auth/qrterminal.js');
  const { PNG } = await import('pngjs');
  const N = 21, P = 4, Q = 2;
  const size = (N + 2 * Q) * P;
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / P) - Q, my = Math.floor(y / P) - Q;
      const inside = mx >= 0 && my >= 0 && mx < N && my < N;
      const v = inside && (mx + my) % 2 === 0 ? 0 : 255; // 棋盘格:可测栅距
      const i = (size * y + x) << 2;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = v;
      png.data[i + 3] = 255;
    }
  }
  const lines = renderQrModules(png.data, size, size, { scale: 2, quiet: 1 }).split('\n');
  // 整图 25 模块(21 内容 + 图自带 4 白边)+ 我们的 quiet 1 → (25+2)×2/2 = 27 行,54 宽
  assert.equal(lines.length, 27);
  assert.ok(lines.every((l) => l.length === 54), `宽度应为 54:${lines[0].length}`);
  assert.ok(lines[13].includes('█') && lines[13].includes(' '), '棋盘图案应黑白交替');
});
