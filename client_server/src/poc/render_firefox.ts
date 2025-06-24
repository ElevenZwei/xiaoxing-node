import { firefox } from 'playwright';
import * as path from 'path';

const outputPath = path.resolve(__dirname, '../../data/output.jpg');

(async () => {
  const browser = await firefox.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err));

  // 1. Load local HTML file
//   await page.goto('http://localhost:17700/index.html');
  await page.goto('file://' + path.resolve(__dirname, 'temp-glb-viewer/index.html'));

  // 2. Wait for render complete signal
  await page.waitForFunction('window.__RENDER_DONE__ === true', { timeout: 10000 });

  // 3. Screenshot the canvas or full page
  const canvas = await page.$('canvas');
  if (!canvas) throw new Error('Canvas not found');

  await canvas.screenshot({ path: outputPath, type: 'jpeg' });
  console.log('✅ Rendered to', outputPath);

  await browser.close();
})();