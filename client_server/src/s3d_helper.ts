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

const keyPath = path.resolve(__dirname, '../config/key.yaml');
const keyFile = fs.readFileSync(keyPath, 'utf8');
const keyYaml = yaml.parse(keyFile);

export enum S3DModel {
  StablePointAware3D = 'stable-point-aware-3d',
  StableFast3D = 'stable-fast-3d',
};
function getS3DModelUrl(model: S3DModel): string {
  switch (model) {
    case S3DModel.StablePointAware3D:
      return `https://api.stability.ai/v2beta/3d/stable-point-aware-3d`;
    case S3DModel.StableFast3D:
      return `https://api.stability.ai/v2beta/3d/stable-fast-3d`;
    default:
      throw new Error(`Unsupported Stable Fast 3D model: ${model}`);
  }
}

export class S3DModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'S3DModelError';
  }
}

async function stable3d(model: S3DModel, image: Buffer, key: string): Promise<Buffer> {
  const typeInfo = await imageType(image);
  if (!typeInfo || !['image/jpeg', 'image/png', 'image/webp'].includes(typeInfo.mime)) {
    throw new Error('Input image must be a JPEG, PNG, or WebP file');
  }
  const form = new FormData();
  form.set('image', new File([image], `input.${typeInfo.ext}`, { type: typeInfo.mime }));
  const encoder = new FormDataEncoder(form);
  try {
    const resp = await axios.post(
      getS3DModelUrl(model),
      Readable.from(encoder.encode()), {
      headers: {
        ...encoder.headers,
        'Authorization': `Bearer ${key}`,
      },
      responseType: 'arraybuffer',
    });
    const glbBuffer = Buffer.from(resp.data);
    return glbBuffer;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('Error in Stable Fast 3D API:', error.message);
      if (error.response) {
        const errorData = error.response.data;
        throw new S3DModelError(`API Error: ${errorData}`);
      } else {
        throw new S3DModelError(`Network Error: ${error.message}`);
      }
    } else {
      console.error('Unexpected error in Stable Fast 3D API:', error);
      throw new S3DModelError(`Unexpected Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export class S3DHelper {
  private key: string;
  constructor(private model: S3DModel) {
    this.key = keyYaml.stability_ai.key;
    if (typeof this.key !== 'string' || this.key.length === 0) {
      throw new Error('Invalid Stability AI API key configuration');
    }
  }
  generate3DModel(image: Buffer): Promise<Buffer> {
    return stable3d(this.model, image, this.key);
  }
}

