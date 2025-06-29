import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { OpenAI, } from 'openai';
import axios from 'axios';
import { AxiosError } from 'axios';
import { catchToString } from './string';

const keyPath = path.resolve(__dirname, '../config/key.yaml');
const keyFile = fs.readFileSync(keyPath, 'utf8');
const key = yaml.parse(keyFile);
const keyVolcano: string = key.tti?.volcano
const keyOpenAI: string = key.tti?.openai;
const keyGrok: string = key.tti?.grok;

export enum TTIProvider {
  Volcano = 'volcano',
  OpenAI = 'openai',
  Grok = 'grok',
}

export enum TTIModel {
  Volcano = 'doubao-seedream-3-0-t2i-250415',
  Grok = 'grok-2-image',
}

function getTTIOption(provider: TTIProvider) {
  switch (provider) {
    case TTIProvider.Volcano:
      if (typeof keyVolcano !== 'string')
        throw new Error('cannot read volcano tti key');
      return {
        apiKey: keyVolcano,
        baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      };
    case TTIProvider.OpenAI:
      if (typeof keyOpenAI !== 'string')
        throw new Error('cannot read openai tti key');
      return {
        apiKey: keyOpenAI,
        baseURL: 'https://api.openai.com/v1',
      };
    case TTIProvider.Grok:
      if (typeof keyGrok !== 'string')
        throw new Error('cannot read grok tti key');
      return {
        apiKey: keyGrok,
        baseURL: 'https://api.x.ai/v1',
      };
    default:
      throw new Error(`Unsupported TTI provider: ${provider}`);
  }
}

export enum TTIImageSize {
  SmallSquare,
  MediumSquare,
  LargeSquare,
  Medium16x9,
  Medium9x16,
  Medium4x3,
  Medium3x4,
  Medium3x2,
  Medium2x3,
}

function TTIImageSizeToString(size: TTIImageSize, provider: TTIProvider): string | undefined {
  if (provider === TTIProvider.Volcano) {
    switch (size) {
      case TTIImageSize.SmallSquare:
        return '512x512';
      case TTIImageSize.MediumSquare:
        return '1024x1024';
      case TTIImageSize.LargeSquare:
        return '2048x2048';
      case TTIImageSize.Medium16x9:
        return '1280x720';
      case TTIImageSize.Medium9x16:
        return '720x1280';
      case TTIImageSize.Medium4x3:
        return '1152x864';
      case TTIImageSize.Medium3x4:
        return '864x1152';
      case TTIImageSize.Medium3x2:
        return '1248x832';
      case TTIImageSize.Medium2x3:
        return '832x1248';
      default:
        console.warn(`Unsupported image size for Volcano: ${size}`);
    }
  } else if (provider === TTIProvider.OpenAI) {
    switch (size) {
      case TTIImageSize.SmallSquare:
        return '256x256';
      case TTIImageSize.MediumSquare:
        return '512x512';
      case TTIImageSize.LargeSquare:
        return '1024x1024';
      case TTIImageSize.Medium3x2:
        return '1536x1024';
      case TTIImageSize.Medium2x3:
        return '1024x1536';
      default:
        console.warn(`Unsupported image size for OpenAI: ${size}`);
    }
  }
  return undefined; // Default fallback size
}

export class TTIHelper {
  private api: OpenAI;
  private provider: TTIProvider;
  private apiModelName: string;

  constructor(provider: TTIProvider, model: TTIModel) {
    this.provider = provider;
    const options = getTTIOption(provider);
    this.api = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
    this.apiModelName = model;
  }

  async generateImage(
    prompt: string,
    size: TTIImageSize = TTIImageSize.Medium16x9,
    n: number = 1): Promise<string[]> {
    const response = await this.api.images.generate({
      model: this.apiModelName,
      prompt: prompt,
      n: n,
      size: TTIImageSizeToString(size, this.provider) as any,
    });
    if (!response.data || response.data.length === 0) {
      throw new Error('No images generated');
    }
    const urls: string[] = response.data
        .map(image => image.url)
        .filter(url => url !== undefined && url !== null);
    if (urls.length === 0) {
      throw new Error('No image URLs returned');
    }
    return urls;
  }
}

export class TTIVolcanoHelper {
  private url = getTTIOption(TTIProvider.Volcano).baseURL;
  private key = getTTIOption(TTIProvider.Volcano).apiKey;
  private model = TTIModel.Volcano;

  /**
    * Generate an image using Volcano TTI.
    * Using axios to make a POST request to the Volcano API.
    * Returns url of the generated image.
    * http request example:
    *   curl -X POST https://ark.cn-beijing.volces.com/api/v3/images/generations \
    *     -H "Content-Type: application/json" \
    *     -H "Authorization: Bearer $ARK_API_KEY" \
    *     -d '{
    *       "model": "doubao-seedream-3-0-t2i-250415",
    *       "prompt": "鱼眼镜头，一只猫咪的头部，画面呈现出猫咪的五官因为拍摄方式扭曲的效果。",
    *       "response_format": "url",
    *       "size": "1024x1024",
    *       "seed": 12,
    *       "guidance_scale": 2.5,
    *       "watermark": false
    *     }'
    * http post response format:
    *   {
    *     "model": "doubao-seedream-3-0-t2i-250415"
    *     "created": 1589478378,  // epoch time in seconds
    *     "data": [
    *       {
    *         "url": "https://..."
    *       }
    *     ],
    *     "usage": {
    *       "generated_images":1  // Number of images generated
    *     },
    *     "error": undefined | { "code": string, "message": string } // If any error occurred
    *   }
    */
  async generateImage(prompt: string, size: TTIImageSize, seed: number = -1): Promise<string> {
    try {
      const response = await axios.post(
        `${this.url}/images/generations`,
        {
          model: this.model,
          prompt: prompt,
          response_format: 'url',
          size: TTIImageSizeToString(size, TTIProvider.Volcano),
          seed: seed >= 0 ? seed : undefined,
          guidance_scale: 2.5,
          watermark: false,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.key}`,
          },
        }
      );
      const data = response.data;
      if (response.status !== 200) {
        throw new Error(`Failed to generate image and no message: ${response.statusText}`);
      }
      if (!data.data || data.data.length === 0) {
        throw new Error('No images generated');
      }
      const urls: string[] = data.data
        .map((image: { url: string }) => image.url)
        .filter((url: string) => url !== undefined && url !== null);
      if (urls.length === 0) {
        throw new Error('No image URLs returned');
      }
      return urls[0];  // Return the first image URL
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        console.error('Error in Volcano TTI API:', error.message);
        if (error.response) {
          const errorData = error.response.data;
          if (typeof errorData.error === 'object' && errorData.error !== null) {
            throw new Error(`Error from Volcano API code: ${errorData.error.code}, msg: ${errorData.error.message}`);
          }
          throw new Error(`API Error: ${errorData}`);
        } else {
          throw new Error(`Network Error: ${error.message}`);
        }
      } else {
        console.error('Unexpected error in Volcano TTI API:', error);
        throw new Error(`Unexpected Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async generateImageFetch(prompt: string, size: TTIImageSize, seed: number = -1): Promise<Buffer> {
    const imageUrl = await this.generateImage(prompt, size, seed);
    return fetchImage(imageUrl);
  }
}

export async function fetchImage(url: string, maxTry: number = 3): Promise<Buffer> {
  let error: any;
  for (let attempt = 0; attempt < maxTry; attempt++) {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
      });
      if (response.status !== 200) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }
      return Buffer.from(response.data);
    } catch (err: unknown) {
      error = err;
      console.error(`Attempt ${attempt + 1} failed:`, catchToString(err));
    }
  }
  if (error instanceof AxiosError) {
    console.error('Error fetching image:', error.message);
    throw new Error(`Failed to fetch image from URL: ${url}`);
  } else {
    // Re-throw other types of errors
    throw error;
  }
}

