// render-glb-puppeteer.ts

import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

const htmlTemplate = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>GLB Viewer</title>
    <style>body { margin: 0; }</style>
  </head>
  <body>
    <script type="module">
      import * as THREE from './libs/three/three.mjs';
      import { GLTFLoader } from './libs/three/examples/jsm/loaders/GLTFLoader.mjs';

      const width = 512;
      const height = 512;

      const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
      renderer.setSize(width, height);
      document.body.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
      camera.position.set(2, 2, 2);
      camera.lookAt(0, 0, 0);

      const light = new THREE.DirectionalLight(0xffffff, 1);
      light.position.set(5, 5, 5);
      scene.add(light);

      const loader = new GLTFLoader();
      loader.load('MODEL_URL', (gltf) => {
        scene.add(gltf.scene);
        renderer.render(scene, camera);
        window.__RENDER_DONE__ = true;
      });
    </script>
  </body>
</html>
`;

async function renderGLBToJPEG(glbPath: string, outputPath: string) {
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
      // '--enable-unsafe-webgpu',
    ]
  });
  console.log(`🔄 Launching Puppeteer browser... done`);
  const page = await browser.newPage();

  console.log(`🔄 Loading GLB file: ${glbPath}`);
  const glbFilename = path.basename(glbPath);
  const htmlContent = htmlTemplate.replace('MODEL_URL', glbFilename);

  const tempDir = path.resolve(__dirname, 'temp-glb-viewer');
  fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'index.html'), htmlContent);
  fs.copyFileSync(glbPath, path.join(tempDir, glbFilename));

  console.log(`🔄 Rendering ${glbPath} to ${outputPath}`);
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err));
  await page.goto(`http://localhost:17700/index.html`);
  console.log('Waiting for GLB to load and render...');
  await page.waitForFunction('window.__RENDER_DONE__ === true', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 500));

  const screenshot = await page.screenshot({ type: 'jpeg' });
  fs.writeFileSync(outputPath, screenshot);

  await browser.close();
  console.log(`✅ Rendered ${outputPath}`);
}

// Run
const inputGLB = path.resolve(__dirname, '../../asset/duck.glb');
const outputJPG = path.resolve(__dirname, '../../data/output-puppeteer.jpg');
renderGLBToJPEG(inputGLB, outputJPG).catch(console.error);

