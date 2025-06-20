import * as readline from 'readline';
import { TTIVolcanoHelper, TTIImageSize, TTIHelper, TTIProvider, TTIModel, fetchImage } from '../tti_helper';
import fs from 'fs';

async function genImageVol(input: string) {
  const ttiHelper = new TTIVolcanoHelper();
  const imageSize = TTIImageSize.Medium16x9;
  const img = await ttiHelper.generateImageFetch(input, imageSize);
  return img;
}

async function genImageGrok(input: string) {
  const ttiHelper = new TTIHelper(TTIProvider.Grok, TTIModel.Grok);
  const urls: string[] = await ttiHelper.generateImage(input);
  const url = urls[0];
  console.log(`获取到的图像 URL: ${url}`);
  return fetchImage(url);
}

async function saveImage(img: Buffer) {
  const filepath = `./data/media/${Date.now()}_sample.jpg`;
  // mkdir if not exists
  fs.mkdirSync('./data/media', { recursive: true });
  await fs.promises.writeFile(filepath, img);
  return `生成了一张图像，保存路径：${filepath}`;
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> ',
});

rl.on('line', async (input: string) => {
  if (input.length === 0) {
    console.log("请输入想要生成图像的提示词。");
    rl.prompt();
    return;
  }
  try {
    const img = await genImageGrok(input);
    const output = await saveImage(img);
    console.log(output);
  } catch (error) {
    console.error("生成图像失败：", error instanceof Error ? error.message : '未知错误');
  }
  rl.prompt();
});

rl.prompt();

