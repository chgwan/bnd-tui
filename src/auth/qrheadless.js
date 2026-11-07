// 无头浏览器扫码登录(full 安装形态:playwright + pngjs)。
// 流程:Chromium 打开官方 maclogin 页 → 页面自身完成轮询/风控 →
//       取二维码 PNG 渲染到终端 → 等待会话 cookie 出现 BDUSS/STOKEN。
import { spawn } from 'node:child_process';
import { renderQrModules, detectModulePitch } from './qrterminal.js';
import { OFFICIAL_DEPS } from '../kernel/loader.js';

export function chromiumEnv() {
  // 1) RHEL8 无 root 时系统可能缺 Chromium 运行库(nss 等),官方 deps 目录里有
  // 2) 与官方 run.sh 同哲学:百度流量直连,剥掉代理变量,避免代理通道拖垮 pan.baidu.com
  // 3) 无头模式不需要 X,不让它连内核的私有 Xvfb
  const env = { ...process.env };
  delete env.DISPLAY;
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete env[k];
  const cur = env.LD_LIBRARY_PATH ?? '';
  if (!cur.split(':').includes(OFFICIAL_DEPS)) env.LD_LIBRARY_PATH = `${OFFICIAL_DEPS}:${cur}`;
  return env;
}

export const MACLOGIN_URL = 'https://pan.baidu.com/disk/maclogin';

export function chooseLoginMode(args, fullAvailable) {
  const has = (name) => args.includes(name);
  if (has('--bduss') || has('--stoken')) return 'bootstrap';
  if (fullAvailable) return 'qr';
  return 'hint';
}

// 同名 cookie 可能有多份(如 STOKEN 同时存在 passport 域与 pan 域,值不同):
// 按 pan.baidu.com > .baidu.com > 其他 的域优先级取
function findCookie(cookies, name) {
  const cands = cookies.filter((c) => c.name === name);
  for (const pref of ['pan.baidu.com', '.baidu.com']) {
    const hit = cands.find((c) => c.domain === pref || c.domain.endsWith(pref));
    if (hit) return hit;
  }
  return cands[0];
}

export function pickCookie(cookies, name) {
  return findCookie(cookies, name)?.value;
}

export async function probeFullInstall({ importImpl } = {}) {
  const impl = importImpl ?? ((spec) => import(spec));
  try {
    await impl('playwright');
    await impl('pngjs');
    return true;
  } catch {
    return false;
  }
}

/**
 * 无头扫码。返回 { bduss, stoken }。
 * 可注入依赖便于测试;正式调用不传时按需 import(仅 full 安装可用)。
 */
function inkRatio(image) {
  const d = new Uint8Array(image.data);
  let dark = 0;
  const n = image.width * image.height;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    if (0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2] < 128) dark++;
  }
  return dark / n;
}

async function acquireQrPng(page, PNG, { log, writeFileSync, qrLoc, switchLoc }) {
  // 自愈式获取:页签不在扫码位就点回来;截图以墨水比例为验收(解码完成 ≠ 已绘制)
  const ensureVisible = async () => {
    if (await qrLoc.isVisible().catch(() => false)) return true;
    await switchLoc.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(800);
    return qrLoc.isVisible().catch(() => false);
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (!(await ensureVisible())) {
      // 首次进入营销页时需要先唤出登录框
      await page.getByText('去登录', { exact: true }).first().click({ timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);
      await ensureVisible();
    }
    await qrLoc.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    await page
      .waitForFunction(
        () => {
          const el = document.querySelector('img.tang-pass-qrcode-img, img[src*="/v2/api/qrcode"]');
          return !!(el && el.complete && el.naturalWidth > 0);
        },
        null,
        { timeout: 20000 },
      )
      .catch(() => {});

    for (let i = 0; i < 12; i++) {
      if (!(await ensureVisible())) continue;
      const pngBytes = await qrLoc.screenshot({ timeout: 5000 }).catch(() => null);
      if (pngBytes) {
        const ratio = inkRatio(PNG.sync.read(pngBytes));
        if (ratio >= 0.05 && ratio <= 0.95) {
          writeFileSync('/tmp/bnd-qr.png', pngBytes); // 诊断/备用扫码文件
          return pngBytes;
        }
      }
      await page.waitForTimeout(1000);
    }

    log('二维码始终未绘制出来,刷新页面重取…');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(3000);
  }
  throw new Error('无法获取登录二维码(稍后重试,或改用 bnd login --bduss/--stoken 引导登录)');
}

export async function qrLoginHeadless({
  timeoutMs = 180000,
  pollIntervalMs = 2000,
  chromiumLaunch,
  log = (s) => console.error(s),
} = {}) {
  const { chromium } = await import('playwright');
  const { PNG } = await import('pngjs');
  const { writeFileSync } = await import('node:fs');
  const launch = chromiumLaunch ?? ((opts) => chromium.launch(opts));
  const browser = await launch({ headless: true, env: chromiumEnv() });
  try {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();
    log('打开官方登录页…');
    let opened = false;
    for (let attempt = 1; attempt <= 2 && !opened; attempt++) {
      try {
        await page.goto(MACLOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
        opened = true;
      } catch (e) {
        if (attempt === 2) throw e;
        log('页面加载失败,重试一次…');
      }
    }

    const qrLoc = page.locator('img.tang-pass-qrcode-img, img[src*="/v2/api/qrcode"]').first();
    // 官方 passport 页签:扫码登录(TANGRAM id 随实例编号变化,用后缀匹配)
    const switchLoc = page.locator('[id*="changeQrCodeItem"], span.switch-item:has-text("扫码登录")').first();

    const pngBytes = await acquireQrPng(page, PNG, { log, writeFileSync, qrLoc, switchLoc });

    // 模块级渲染:按终端宽×高双约束选倍率;放不下 2× 时自动在 VNC 桌面打开二维码图片
    const termCols = process.stderr.columns ?? process.stdout.columns ?? 80;
    const termLines = process.stderr.rows ?? process.stdout.rows ?? 24;
    const openInViewer = (pngPath) => {
      if (!process.env.DISPLAY) return 'no-display';
      // 精简 VNC 里 xdg-open 常无关联;按序尝试已知查看器
      for (const cmd of [
        ['eog', [pngPath]],
        ['feh', [pngPath]],
        ['display', [pngPath]],
        ['xdg-open', [pngPath]],
      ]) {
        try {
          const child = spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore', env: process.env });
          return cmd[0]; // spawn 成功即认为已拉起(找不到命令会异步报错,延迟兜底 xdg-open)
        } catch {
          continue;
        }
      }
      return null;
    };

    // 生成 10× 纯黑白大图:任何查看器/任何缩放下都可识别
    const makeBigPng = (bytes) => {
      const img = PNG.sync.read(bytes);
      const pitch = detectModulePitch(new Uint8Array(img.data), img.width, img.height);
      if (!pitch || pitch < 1) return null;
      const cols = Math.floor(img.width / pitch);
      const rows = Math.floor(img.height / pitch);
      const Q = 4, PX = 10; // 4 模块白边 + 每模块 10px
      const W = (cols + 2 * Q) * PX, H = (rows + 2 * Q) * PX;
      const out = new PNG({ width: W, height: H });
      const lum = (x, y) => {
        const i = ((y * img.width + x) << 2);
        return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      };
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const mx = Math.floor(x / PX) - Q, my = Math.floor(y / PX) - Q;
          const dark = mx >= 0 && my >= 0 && mx < cols && my < rows
            && lum(Math.min(img.width - 1, Math.floor((mx + 0.5) * pitch)), Math.min(img.height - 1, Math.floor((my + 0.5) * pitch))) < 128;
          const i = (y * W + x) << 2;
          out.data[i] = out.data[i + 1] = out.data[i + 2] = dark ? 0 : 255;
          out.data[i + 3] = 255;
        }
      }
      writeFileSync('/tmp/bnd-qr-big.png', PNG.sync.write(out));
      return '/tmp/bnd-qr-big.png';
    };
    const renderAndShow = (bytes, note) => {
      const img = PNG.sync.read(bytes);
      const pitch = detectModulePitch(new Uint8Array(img.data), img.width, img.height);
      const moduleCols = pitch > 0 ? Math.floor(img.width / pitch) : img.width;
      const span = moduleCols + 4; // 含白边的模块跨度
      // 默认小码(1×);BND_QR_SCALE=2 强制放大(可能超出屏幕需要滚动)
      const scale = Number(process.env.BND_QR_SCALE) === 2 ? 2 : 1;

      log(`请用百度网盘 App / 百度 App 扫描以下二维码${note ?? ''}:\n`);
      const big = makeBigPng(bytes);
      if (scale === 2 && (span * 2 > termCols || span > termLines - 2)) {
        const target = big ?? '/tmp/bnd-qr.png';
        const opened = openInViewer(target);
        log(
          `(终端 ${termCols}×${termLines} 放不下 2×(需 ${span * 2}×${span})` +
            (opened === 'no-display' ? `,备用大图 ${target}` : opened ? `,已用 ${opened} 打开 ${target}` : `,自动打开失败,备用 ${target}`) +
            ')',
        );
      } else {
        log(`(扫不出时备用:VNC 里打开 ${big ?? '/tmp/bnd-qr.png'},或设 BND_QR_SCALE=2)`);
      }
      console.error(renderQrModules(new Uint8Array(img.data), img.width, img.height, { scale, quiet: 2 }));
      console.error('');
    };
    renderAndShow(pngBytes);

    // 等待扫码:页面自己轮询,我们只等 cookie;期间保活(页签被切走则切回、码过期则自动刷新重渲染)
    const refreshOverlay = page.locator('[class*="Qrcode-status-refresh"]').first();
    const deadline = Date.now() + timeoutMs;
    let lastReport = 0;
    let bdussOnlySince = 0;
    let navigatedForStoken = false;
    for (;;) {
      if (Date.now() > deadline) throw new Error('扫码超时(可用 BND_QR_TIMEOUT_MS 调整)');
      const cookies = await ctx.cookies();
      const bduss = pickCookie(cookies, 'BDUSS');
      const stoken = pickCookie(cookies, 'STOKEN');
      if (bduss && stoken) {
        // pan 域的 STOKEN 在访问 pan 后才下发,此前读到的可能是 passport 域的值,须重读
        await page.goto('https://pan.baidu.com/disk/home', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);
        const jar = await ctx.cookies();
        log(`STOKEN 来源域:${findCookie(jar, 'STOKEN')?.domain ?? '无'}`);
        return { bduss: pickCookie(jar, 'BDUSS') ?? bduss, stoken: pickCookie(jar, 'STOKEN') ?? stoken };
      }

      // 诊断心跳:每 10s 报告剩余时间与已捕获 cookie 名(不显示值)
      const now = Date.now();
      if (now - lastReport > 10000) {
        lastReport = now;
        log(`等待扫码确认…(剩余 ${Math.ceil((deadline - now) / 1000)}s;cookie:BDUSS ${bduss ? '✓' : '✗'} / STOKEN ${stoken ? '✓' : '✗'})`);
      }

      // 只有 BDUSS:导航 pan 主页触发 STOKEN 下发(一次,留 8s 等待窗)
      if (bduss && !stoken) {
        if (!bdussOnlySince) bdussOnlySince = now;
        if (now - bdussOnlySince > 8000 && !navigatedForStoken) {
          navigatedForStoken = true;
          log('已捕获 BDUSS,访问 pan.baidu.com 触发 STOKEN 下发…');
          await page.goto('https://pan.baidu.com/disk/home', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await page.waitForTimeout(3000);
          continue;
        }
      }

      if (!(await qrLoc.isVisible().catch(() => false))) {
        await switchLoc.click({ timeout: 3000 }).catch(() => {});
      } else if (await refreshOverlay.isVisible().catch(() => false)) {
        log('二维码已过期,自动刷新…');
        await refreshOverlay.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(2500);
        const fresh = await acquireQrPng(page, PNG, { log, writeFileSync, qrLoc, switchLoc }).catch(() => null);
        if (fresh) renderAndShow(fresh, '(新码,请扫这张)');
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  } finally {
    await browser.close().catch(() => {});
  }
}
