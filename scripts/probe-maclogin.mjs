#!/usr/bin/env node
// 调试探针:无头 Chromium 打开 maclogin,转储 URL/iframe/img/canvas/正文 + 整页截图。
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
});
await page.goto('https://pan.baidu.com/disk/maclogin', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(8000);

console.log('URL:', page.url());
console.log('title:', await page.title());
for (const f of page.frames()) console.log('frame:', f.url().slice(0, 110));

// 尝试点击“去登录”按钮
try {
  await page.getByText('去登录', { exact: true }).first().click({ timeout: 8000 });
  console.log('--- 已点击 去登录,等待渲染 ---');
  await page.waitForTimeout(15000);
  console.log('URL:', page.url());
  for (const f of page.frames()) console.log('frame:', f.url().slice(0, 110));
} catch (e) {
  console.log('点击 去登录 失败:', e.message.split('\n')[0]);
}

// QR img 加载状态诊断
const qr = await page.evaluate(() => {
  const el = document.querySelector('img.tang-pass-qrcode-img, img[src*="/v2/api/qrcode"]');
  if (!el) return { found: false };
  return {
    found: true,
    complete: el.complete,
    naturalWidth: el.naturalWidth,
    naturalHeight: el.naturalHeight,
    clientWidth: el.clientWidth,
    src: el.src.slice(0, 130),
    visible: !!(el.offsetParent || el.getClientRects().length),
  };
});
console.log('QR img:', JSON.stringify(qr, null, 2));

const info = await page.evaluate(() => ({
  imgs: [...document.querySelectorAll('img')].map((i) => ({
    src: (i.src || '').slice(0, 100), cls: String(i.className).slice(0, 50), w: i.width, h: i.height,
  })),
  canvases: [...document.querySelectorAll('canvas')].map((c) => ({
    cls: String(c.className).slice(0, 50), w: c.width, h: c.height,
  })),
  bodyText: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300),
}));
console.log(JSON.stringify(info, null, 2).slice(0, 2200));

await page.screenshot({ path: '/tmp/bnd-recon/maclogin_headless.png', fullPage: true });
console.log('screenshot → /tmp/bnd-recon/maclogin_headless.png');

// 复刻产品路径:元素截图 + 墨水分析(与 qrheadless 相同逻辑)
import { PNG as PNG2 } from 'pngjs';
if (qr.found) {
  const loc = page.locator('img.tang-pass-qrcode-img, img[src*="/v2/api/qrcode"]').first();
  await loc.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  const png = await loc.screenshot().catch((e) => { console.log('元素截图失败:', e.message.split('\n')[0]); return null; });
  if (png) {
    const img = PNG2.sync.read(png);
    const d = new Uint8Array(img.data);
    let dark = 0;
    for (let i = 0; i < img.width * img.height; i++) {
      const j = i * 4;
      if (0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2] < 128) dark++;
    }
    console.log('元素截图:', img.width + 'x' + img.height, '墨水', (dark / (img.width * img.height) * 100).toFixed(1) + '%');
    const { writeFileSync } = await import('node:fs');
    writeFileSync('/tmp/bnd-qr-probe.png', png);
    console.log('→ /tmp/bnd-qr-probe.png');
  }
}
await browser.close();
