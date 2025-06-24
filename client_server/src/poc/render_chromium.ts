// render-glb-puppeteer.ts

import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

async function renderGLBToJPEG(outputPath: string) {
  console.log(`🔄 Launching Puppeteer browser...`);
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 512, height: 512 },
    args: [ 
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--disable-gpu',
    ]
  });
  const page = await browser.newPage();

  console.log(`🔄 Rendering to ${outputPath}`);
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err));
  // chromium does not support file:// URLs directly, so we use a local server
  await page.goto(`http://localhost:17700/index.html`);
  await page.waitForFunction('window.__RENDER_DONE__ === true', { timeout: 30000 });

  const screenshot = await page.screenshot({ type: 'jpeg' });
  fs.writeFileSync(outputPath, screenshot);

  await browser.close();
  console.log(`✅ Rendered ${outputPath}`);
}

// Run
const outputJPG = path.resolve(__dirname, '../../data/output-puppeteer.jpg');
renderGLBToJPEG(outputJPG).catch(console.error);

