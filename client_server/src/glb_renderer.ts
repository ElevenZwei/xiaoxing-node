import fs from 'fs';
import path from 'path';

import { firefox, Browser, Page } from 'playwright';
import { v4 as uuidv4 } from 'uuid';

const htmlDir = path.join(__dirname, 'html/glb_render');

type PageFunctions = {
  initCanvas: (width: number, height: number) => Promise<void>;
  loadModel: (modelFileName: string) => Promise<void>;
  setOrbit: (pitch: number, yaw: number) => Promise<void>;
};

export class GlbRenderer {
  private static browser?: Browser;
  private page?: Page;

  async spinUp(width: number = 1024, height: number = 1024) {
    if (GlbRenderer.browser === undefined) {
      GlbRenderer.browser = await firefox.launch({ headless: true });
    }
    if (this.page === undefined) {
      this.page = await GlbRenderer.browser.newPage();
      // TODO: change to logger.
      this.page.on('console', msg => console.log('RENDER LOG:', msg.text()));
      this.page.on('pageerror', err => console.error('RENDER ERROR:', err));
      // load local HTML file and initialize canvas
      await this.page.goto('file://' + path.join(htmlDir, '/index.html'));
      await this.page.waitForLoadState('networkidle');
      await this.page.evaluate(({ width, height }) => {
        return new Promise<void>(async (resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Initialization timeout after 5000ms'));
          }, 5000);
          const func = (window as any).func as PageFunctions;
          if (typeof func.initCanvas === 'function') {
            await func.initCanvas(width, height);
            clearTimeout(timeout);
            resolve();
          } else {
            clearTimeout(timeout);
            reject(new Error('initCanvas function not found'));
          }
        });
      }, { width, height });
    }
  }

  async spinDown() {
    if (this.page) {
      await this.page.close();
      this.page = undefined;
    }
    if (GlbRenderer.browser) {
      await GlbRenderer.browser.close();
      GlbRenderer.browser = undefined;
    }
  }

  async loadModel(model: Buffer) {
    // write model to a temporary file
    const modelFileName = `model_${uuidv4().replace(/-/g, '')}.glb`;
    const modelPath = path.join(htmlDir, modelFileName);
    try {
      await fs.promises.writeFile(modelPath, model);
      if (this.page == null) {
        throw new Error('Page is not initialized. Please call spinUp() first.');
      }
      await this.page.evaluate(({ modelFileName }) => {
        return new Promise<void>(async (resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Initialization timeout after 5000ms'));
          }, 5000);
          const func = (window as any).func as PageFunctions;
          if (typeof func.loadModel === 'function') {
            await func.loadModel(`./${modelFileName}`);
            clearTimeout(timeout);
            resolve();
          } else {
            clearTimeout(timeout);
            reject(new Error('loadModel function not found'));
          }
        });
      }, { modelFileName });
    } finally {
      // Clean up temporary model file
      try {
        await fs.promises.unlink(modelPath);
        // console.log('✅ Cleaned up temporary model file:', modelPath);
      } catch (err) {
        console.error('Error cleaning up temporary model file:', err);
      }
    }
  }

  async renderImage(pitch: number, yaw: number): Promise<Buffer> {
    if (this.page == null) {
      throw new Error('Page is not initialized. Please call spinUp() first.');
    }
    await this.page.evaluate(({ pitch, yaw }) => {
      return new Promise<void>(async (resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Render timeout after 5000ms'));
        }, 5000);
        const func = (window as any).func as PageFunctions;
        if (typeof func.setOrbit === 'function') {
          await func.setOrbit(pitch, yaw);
          clearTimeout(timeout);
          resolve();
        } else {
          clearTimeout(timeout);
          reject(new Error('setOrbit function not found'));
        }
      });
    }, { pitch, yaw });
    const canvas = await this.page.$('canvas');
    if (!canvas) throw new Error('Canvas not found');
    const img = await canvas.screenshot({ type: 'jpeg' });
    return img;
  }
}
