// Stable Fast 3D Api
// Convert image into 3d model glb file.

import axios from 'axios';
import { FormData, File } from 'formdata-node';
import { FormDataEncoder } from 'form-data-encoder';
import { Readable } from 'stream';
import imageType from 'image-type';
import fs from 'fs';
import path from 'path'
import yaml from 'yaml';

const keyPath = path.resolve(__dirname, '../../config/key.yaml');
const keyFile = fs.readFileSync(keyPath, 'utf8');
const keyYaml = yaml.parse(keyFile);
const keySai = keyYaml.stability_ai.key;

if (typeof keySai !== 'string' || keySai.length === 0) {
  throw new Error('Invalid Stability AI API key configuration');
}
const url = `https://api.stability.ai/v2beta/3d/stable-point-aware-3d`;

async function stable3d(image: Buffer): Promise<Buffer> {
  const typeInfo = await imageType(image);
  if (!typeInfo || !['image/jpeg', 'image/png', 'image/webp'].includes(typeInfo.mime)) {
    throw new Error('Input image must be a JPEG, PNG, or WebP file');
  }
  const form = new FormData();
  form.set('image', new File([image], `input.${typeInfo.ext}`, { type: typeInfo.mime }));
  const encoder = new FormDataEncoder(form);
  return axios.post(url, Readable.from(encoder.encode()), {
    headers: {
      ...encoder.headers,
      'Authorization': `Bearer ${keySai}`,
    },
    responseType: 'arraybuffer',
  }).then(response => {
    const glbBuffer = Buffer.from(response.data);
    return glbBuffer;
  }).catch((error) => {
    console.error('Error in Stable Fast 3D API:', error.message);
    throw error;
  });
}

// const image = fs.readFileSync(path.resolve(__dirname, '../../asset/duck.jpg'))
const image = fs.readFileSync(path.resolve(__dirname, '../../data/bottle5.jpg'))

stable3d(image).then((glbBuffer) => {
  const outputPath = path.resolve(__dirname, '../../data/bottle5_sp3d.glb');
  fs.writeFileSync(outputPath, glbBuffer);
  console.log('✅ GLB model saved to', outputPath);
}).catch((error) => {
  console.error('❌ Failed to generate GLB model:', error.message);
});

