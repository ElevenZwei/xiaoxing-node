import fs from 'fs';
import path from 'path';

import { firefox, Browser, Page } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import { Mutex } from 'async-mutex';

const htmlDir = path.join(__dirname, 'html/glb_render');

type PageFunctions = {
  initCanvas: (width: number, height: number) => Promise<void>;
  loadModel: (modelFileName: string) => Promise<void>;
  setOrbit: (pitch: number, yaw: number) => Promise<void>;
};

export class GlbRenderer {
  private static browser?: Browser;
  private page?: Page;
  // Mutex for each page to ensure thread-safe operations
  private pageMutex: Map<Page, Mutex> = new Map();

  async spinUp(width: number = 1024, height: number = 1024) {
    if (GlbRenderer.browser === undefined) {
      GlbRenderer.browser = await firefox.launch({
        headless: true,
      });
    }
    if (this.page === undefined) {
      this.page = await this.createPage(width, height);
    }
  }

  async spinDown() {
    if (this.page) {
      this.closePage(this.page)
    }
    if (GlbRenderer.browser) {
      await GlbRenderer.browser.close();
      GlbRenderer.browser = undefined;
    }
  }

  get defaultPage() { return this.page; }

  async createPage(width: number = 1024, height: number = 1024): Promise<Page> {
    if (GlbRenderer.browser === undefined) {
      throw new Error('Browser is not initialized. Please call spinUp() first.');
    }
    const page = await GlbRenderer.browser.newPage();
    // TODO: change to logger.
    page.on('console', msg => console.log('RENDER LOG:', msg.text()));
    page.on('pageerror', err => console.error('RENDER ERROR:', err));
    // load local HTML file and initialize canvas
    await page.goto('file://' + path.join(htmlDir, '/index.html'));
    await page.waitForLoadState('networkidle');
    await page.evaluate(({ width, height }) => {
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
    this.pageMutex.set(page, new Mutex());
    return page;
  }

  async closePage(page: Page) {
    await page.close();
    this.pageMutex.delete(page);
    if (this.page === page) {
      this.page = undefined;
    }
  }

  async loadModel(model: Buffer, page: Page | undefined = this.defaultPage) {
    // write model to a temporary file
    const modelFileName = `model_${uuidv4().replace(/-/g, '')}.glb`;
    const modelPath = path.join(htmlDir, modelFileName);
    try {
      await fs.promises.writeFile(modelPath, model);
      if (page == null) {
        throw new Error('Page is not initialized. Please call spinUp() first.');
      }
      const mutex = this.pageMutex.get(page);
      if (mutex === undefined) {
        throw new Error('Page mutex not found. Please ensure the page is created with createPage().');
      }
      await mutex.runExclusive(async () => {
        await page.evaluate(({ modelFileName }) => {
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
      });
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

  async renderImage(pitch: number, yaw: number, page: Page | undefined = this.defaultPage): Promise<Buffer> {
    if (page == null) {
      throw new Error('Page is not initialized. Please call spinUp() first.');
    }
    const mutex = this.pageMutex.get(page);
    if (mutex === undefined) {
      throw new Error('Page mutex not found. Please ensure the page is created with createPage().');
    }
    const img = await mutex.runExclusive(async () => {
      await page.evaluate(({ pitch, yaw }) => {
        return new Promise<void>(async (resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Render timeout after 5000ms'));
          }, 5000);
          const func = (window as any).func as PageFunctions;
          if (typeof func.setOrbit === 'function') {
            // 这里很重要，yaw + 180 是为了让模型正面朝向相机
            // 如果不加 180，S3D 生成的模型会背对相机
            await func.setOrbit(pitch, yaw + 180);
            clearTimeout(timeout);
            resolve();
          } else {
            clearTimeout(timeout);
            reject(new Error('setOrbit function not found'));
          }
        });
      }, { pitch, yaw });
      const canvas = await page.$('canvas');
      if (!canvas) throw new Error('Canvas not found');
      const img = await canvas.screenshot({ type: 'jpeg' });
      return img;
    });
    return img;
  }
}
