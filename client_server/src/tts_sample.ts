// import { TTSVolcano, TTSDeltaHook } from './tts_helper';
import { TTSStreamVolcano, TTSDeltaHook } from './tts_stream_helper';
import * as readline from 'readline';
import fs from 'fs';
import path from 'path';

const tts = new TTSStreamVolcano();
tts.setSpeaker('multi_female_shuangkuaisisi_moon_bigtts');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> ',
});

rl.on('line', async (input: string) => {
  if (input.length === 0) {
    console.log("请输入想要语音合成的话。");
    rl.prompt();
    return;
  }
  await tts.beginSession();
  await tts.addText(input);
  await tts.endSession();
  const output = await tts.waitFinish();
  // save output to a file with name '../data/tts/input.ogg';
  const filename = input.replace(/[/%@$#\[\]{}. ]/g, '_').substring(0, 20) || 'default';
  const outputPath = path.join(__dirname, `../data/tts/${filename}.ogg`);
  // mkdir if not exists
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output);
  console.log(`TTS output saved to ${outputPath}`);
  rl.prompt();
});

rl.prompt();

