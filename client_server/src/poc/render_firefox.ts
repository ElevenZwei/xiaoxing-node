import fs from 'fs';
import { firefox } from 'playwright';
import * as path from 'path';

const htmlDir = path.join(__dirname, '/temp-glb-viewer');
const outputDir = path.join(__dirname, '../../data/');

async function renderModel(model: Buffer, outputPrefix: string) {
  // save model to a temporary file
  const modelFileName = `model_${Date.now()}.glb`;
  const modelPath = path.join(htmlDir, modelFileName);
  try {
    await fs.promises.writeFile(modelPath, model);

    const browser = await firefox.launch({ headless: true });
    const page = await browser.newPage();

    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err));

    // 1. Load local HTML file
    await page.goto('file://' + path.join(htmlDir, '/index.html'));
    await page.waitForLoadState('networkidle');
    console.log('✅ Loaded HTML file');

    await page.evaluate(({ modelFileName }) => {
      return new Promise<void>(async (resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Initialization timeout after 5000ms'));
        }, 5000);
        if (typeof (window as any).initCanvas === 'function') {
          await (window as any).initCanvas(1024, 1024);
          await (window as any).loadModel(`./${modelFileName}`);
          clearTimeout(timeout);
          resolve();
        } else {
          clearTimeout(timeout);
          reject(new Error('initCanvas function not found'));
        }
      });
    }, { modelFileName });


    async function renderImage(pitch: number, yaw: number): Promise<void> {
      await page.evaluate(({ pitch, yaw }) => {
        if (typeof (window as any).setOrbit === 'function') {
          (window as any).setOrbit(pitch, yaw);
        } else {
          throw (new Error('setOrbit function not found'));
        }
      }, { pitch, yaw });

      const canvas = await page.$('canvas');
      if (!canvas) throw new Error('Canvas not found');

      const outputPath = path.join(outputDir, `${outputPrefix}_${pitch}_${yaw}.jpeg`);
      await canvas.screenshot({ path: outputPath, type: 'jpeg' });
      console.log('✅ Rendered to', outputPath);
    }

    for (let pitch = 0; pitch <= 30; pitch += 10) {
      for (let yaw = 0; yaw <= 360; yaw += 60) {
        await renderImage(pitch, yaw);
      }
    }

    await browser.close();
  } finally {
    // Clean up temporary model file
    try {
      await fs.promises.unlink(modelPath);
      console.log('✅ Cleaned up temporary model file:', modelPath);
    } catch (err) {
      console.error('Error cleaning up temporary model file:', err);
    }
  }
}

const modelPath = path.resolve(__dirname, '../../data/bottle5_sp3d.glb');
// const modelPath = path.resolve(__dirname, '../../asset/duck.glb');
const modelBuffer = fs.readFileSync(modelPath);
renderModel(modelBuffer, 'bottle5').catch(err => {
  console.error('Error rendering model:', err);
});

