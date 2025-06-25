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
  await page.waitForLoadState('networkidle');
  console.log('✅ Loaded HTML file');

  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        reject(new Error('Initialization timeout after 5000ms'));
      }, 5000);
      if (typeof (window as any).initCanvas === 'function') {
        (window as any).initCanvas(1024, 1024);
        resolve((window as any).loadModel('./duck.glb'));
      } else {
        reject(new Error('initCanvas function not found'));
      }
    });
  });

  // 2. Wait for render complete signal
  await page.evaluate(({ pitch, yaw }) => {
    if (typeof (window as any).setOrbit === 'function') {
      (window as any).setOrbit(pitch, yaw);
    } else {
      throw (new Error('setOrbit function not found'));
    }
  }, { pitch: 30, yaw: 155 });

  // 3. Screenshot the canvas or full page
  const canvas = await page.$('canvas');
  if (!canvas) throw new Error('Canvas not found');

  await canvas.screenshot({ path: outputPath, type: 'jpeg' });
  console.log('✅ Rendered to', outputPath);

  await browser.close();
})();
