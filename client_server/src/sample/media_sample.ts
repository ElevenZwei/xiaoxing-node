import fs from 'fs';
import path from 'path';
import { convertWavToOpusOgg } from '../media';

async function main() {
  const filename = 'asr_example_zh';
  const inputPath = path.join(__dirname, `../data/media/${filename}.wav`);
  const outputPath = path.join(__dirname, `../data/media/${filename}.ogg`);
  // Read the WAV file
  const wavBuffer = fs.readFileSync(inputPath);
  console.log(`Read ${wavBuffer.length} bytes from ${inputPath}`);
  // Convert to OGG Opus format
  const oggBuffer = await convertWavToOpusOgg(wavBuffer);
  console.log(`Converted to OGG Opus format, size: ${oggBuffer.length} bytes`);
  // Write the OGG file
  fs.writeFileSync(outputPath, oggBuffer);
  console.log(`Saved converted file to ${outputPath}`);
}

main().catch(console.error);

