import fs from 'fs';
import yaml from 'yaml'
import path from 'path'

import WebSocket from 'ws';
import zlib from 'zlib';
import { v4 as uuidv4 } from 'uuid';
import * as z from 'zod/v4';

const keyPath = path.resolve(__dirname, '../config/key.yaml');
const keyFile = fs.readFileSync(keyPath, 'utf8');
const keyYaml = yaml.parse(keyFile);
const keyVolc = keyYaml.tts.volcano;

const appid = keyVolc.appid;
const token = keyVolc.token;
const cluster = keyVolc.cluster;
const default_voice_type = 'zh_female_yuanqinvyou_moon_bigtts';
const host = 'openspeech.bytedance.com';
const api_url = `wss://${host}/api/v1/tts/ws_binary`;

const RequestJsonSchema = z.object({
  app: z.object({
    appid: z.string(),
    token: z.string(),
    cluster: z.string(),
  }),
  user: z.object({
    uid: z.string(),
  }),
  audio: z.object({
    voice_type: z.string(),
    encoding: z.literal('ogg_opus'), // 如果有多个可选值也可以用 z.enum([...])
    speed_ratio: z.number(),
    volume_ratio: z.number(),
    pitch_ratio: z.number(),
    explicit_language: z.string().optional(),
    context_language: z.string().optional(),
  }),
  request: z.object({
    reqid: z.string(),
    text: z.string(),
    operation: z.string(),
  }),
});
type RequestJson = z.infer<typeof RequestJsonSchema>;

export type TTSDeltaHook = (delta: Buffer | null) => void;

export class TTSVolcano {
  static readonly defaultHeader = Buffer.from([0x11, 0x10, 0x11, 0x00]);
  speaker: string = default_voice_type;
  hook: TTSDeltaHook | undefined = undefined;

  setSpeaker(speaker: string) {
    this.speaker = speaker;
  }

  setDeltaHook(hook: TTSDeltaHook) {
    this.hook = hook;
  }

  speak(text: string): Promise<Buffer> {
    const reqJson = this.makeRequest(text);
    const payload = zlib.gzipSync(Buffer.from(JSON.stringify(reqJson), 'utf-8'));

    const fullRequest = Buffer.concat([
      TTSVolcano.defaultHeader,
      Buffer.alloc(4),
      payload
    ]);
    fullRequest.writeUInt32BE(payload.length, 4);

    const ws = new WebSocket(api_url, {
      headers: { Authorization: `Bearer; ${token}` }
    });
    ws.on('open', () => {
      // console.log(`Sending tts stream request...`);
      ws.send(fullRequest);
    });

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
        if (!isBinary) {
          console.error(`TTS should not recv text data: ${data.toString()}`);
          return;
        }
        const buffer = data as Buffer;
        const delta = this.parseResponse(buffer);
        if (this.hook) {
          this.hook(delta);
        }
        if (delta !== null) {
          chunks.push(delta);
        } else {
          console.log('TTS end of stream.');
          const result = Buffer.concat(chunks);
          resolve(result);
          ws.close();
        }
      });
      ws.on('error', (err) => {
        console.error('TTS error:', err);
        reject(err);
      });
      ws.on('close', () => {
        console.log('TTS connection closed.');
        reject(new Error('WebSocket connection closed unexpectedly.'));
      });
    });
  }

  private parseResponse(buffer: Buffer): Buffer | null {
    // const protocolVersion = buffer[0] >> 4;
    const headerSize = buffer[0] & 0x0f;
    const messageType = buffer[1] >> 4;
    const flags = buffer[1] & 0x0f;
    // const serialization = buffer[2] >> 4;
    const compression = buffer[2] & 0x0f;
    const payload = buffer.subarray(headerSize * 4);

    if (messageType === 0x0b) {
      // console.log(`Received message type 0x0b, flags: ${flags}`);
      if (flags === 0) return Buffer.alloc(0); // continue to receive
      if (flags === 2 || flags === 3) return null;
      const seq = payload.readInt32BE(0);
      if (seq < 0) return null;
      // const payloadSize = payload.readUInt32BE(4);
      const audioPayload = payload.subarray(8);
      console.log(`TTS audio chunk, seq: ${seq}, size: ${audioPayload.length}`);
      return audioPayload;
    } else if (messageType === 0x0f) {
      const code = payload.readUInt32BE(0);
      const msgSize = payload.readUInt32BE(4);
      let errorMsg = payload.subarray(8);
      if (compression === 1) {
        errorMsg = zlib.gunzipSync(errorMsg);
      }
      console.error(`TTS Error: code=${code}, msgSize=${msgSize}, msg=${errorMsg}`);
      return null;
    } else {
      console.warn('Unknown message type:', messageType);
      return null;
    }
  }

  private makeRequest(text: string): RequestJson {
    const reqid = uuidv4();
    return {
      app: {
        appid,
        token,
        cluster,
      },
      user: {
        uid: '38880808'
      },
      audio: {
        voice_type: this.speaker,
        encoding: 'ogg_opus',
        speed_ratio: 1.0,
        volume_ratio: 1.0,
        pitch_ratio: 1.0,
        explicit_language: 'crosslingual',
      },
      request: {
        reqid,
        text,
        operation: 'submit'
      }
    };
  }

  
};
