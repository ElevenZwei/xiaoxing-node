import fs from 'fs'
import path from 'path'
import { GlbRenderer } from '../glb_renderer'

const renderer = new GlbRenderer();
async function renderModel(modelPath: string, savePrefix: string) {
  const model = await fs.promises.readFile(modelPath);
  console.log(`✅ [${Date.now()}] Renderer spining up.`);
  console.log(`✅ [${Date.now()}] Renderer spun up for model: ${modelPath}`);
  await renderer.spinUp();
  const page = await renderer.createPage(1280, 720);
  await renderer.loadModel(model, page);
  console.log(`✅ [${Date.now()}] Renderer loaded model: ${modelPath}`);
  const failures: string[] = [];
  for (let pitch = 0; pitch <= 30; pitch += 10) {
    for (let yaw = 0; yaw <= 360; yaw += 60) {
      await renderer.renderImage(pitch, yaw, page)
      .then(img => {
        const outputPath = path.join('../../data/', `${savePrefix}_${pitch}_${yaw}.jpeg`);
        return fs.promises.writeFile(outputPath, img);
      }).then(() => {
        // console.log(`✅ Rendered to ${savePrefix}_${pitch}_${yaw}.jpeg`)
      }).catch(err => {
        console.error(`❌ Error rendering image at pitch ${pitch}, yaw ${yaw}:`, err)
        failures.push(`pitch ${pitch}, yaw ${yaw}`);
      });
    }
  }
  await renderer.closePage(page);
  if (failures.length > 0) {
    console.error('❌ Some images failed to render:', failures.join(', '));
  } else {
    console.log(`✅ [${Date.now()}] All images rendered successfully.`);
  }
}

async function main() {
  try {
    await renderModel(path.resolve(__dirname, '../../data/bottle_sp3d.glb'), 'bottle');
    await renderModel(path.resolve(__dirname, '../../data/bottle5_sp3d.glb'), 'bottle5');
  } catch (err) {
    console.error('❌ Error rendering model:', err);
  }
  await renderer.spinDown();
}

main()

