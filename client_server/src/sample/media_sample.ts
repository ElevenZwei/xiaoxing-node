import fs from 'fs';
import path from 'path';
import { resizeJpeg, convertWavToOpusOgg } from '../media';

async function audioConvert() {
  const filename = 'asr_example_zh';
  const inputPath = path.join(__dirname, `../../data/media/${filename}.wav`);
  const outputPath = path.join(__dirname, `../../data/media/${filename}.ogg`);
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

async function imageResize() {
  const filename = 'sample';
  const inputPath = path.join(__dirname, `../../data/media/${filename}.jpg`);
  const outputPath = path.join(__dirname, `../../data/media/${filename}_resized.jpg`);
  // Read the image file
  const imageBuffer = fs.readFileSync(inputPath);
  console.log(`Read ${imageBuffer.length} bytes from ${inputPath}`);
  // Resize the image (assuming a resize function exists)
  // This is a placeholder for actual resizing logic
  const resizedImageBuffer = await resizeJpeg(imageBuffer, { scale: 2, method: 'bicubic' });
  // For demonstration, we'll just write the original image to the output path
  fs.writeFileSync(outputPath, resizedImageBuffer);
  console.log(`Saved resized image to ${outputPath}`);
}

// audioConvert().catch(console.error);
// imageResize().catch(console.error);

