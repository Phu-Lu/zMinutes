// Rasterize the source SVG so installed PWA icons match the in-app theme.
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
  try {
    const root = path.resolve(__dirname, '..');
    const svg = fs.readFileSync(path.join(root, 'zminutes-icon.svg'), 'utf8');
    for (const size of [192, 512]) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await page.setContent('<style>body{margin:0}svg{display:block;width:100%;height:100%}</style>' + svg);
      await page.screenshot({ path: path.join(root, `zminutes-icon-${size}.png`), omitBackground: true });
      await page.close();
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
