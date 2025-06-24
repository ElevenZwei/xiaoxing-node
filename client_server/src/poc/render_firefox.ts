import { firefox } from 'playwright';
import * as path from 'path';

const outputPath = path.resolve(__dirname, '../../data/output.jpg');

(async () => {
  const browser = await firefox.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err));

  // 1. Load local HTML file
  await page.goto('file://' + path.resolve(__dirname, 'temp-glb-viewer/index.html'));

  // 2. Wait for render complete signal
  await page.evaluate(({ pitch, yaw, timeoutMs }) => {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`render-done event timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      window.addEventListener('render-done', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });

      if (typeof (window as any).setOrbit === 'function') {
        (window as any).setOrbit(pitch, yaw);
      }
    });
  }, { pitch: 30, yaw: 90, timeoutMs: 5000 });

  // 3. Screenshot the canvas or full page
  const canvas = await page.$('canvas');
  if (!canvas) throw new Error('Canvas not found');

  await canvas.screenshot({ path: outputPath, type: 'jpeg' });
  console.log('✅ Rendered to', outputPath);

  await browser.close();
})();