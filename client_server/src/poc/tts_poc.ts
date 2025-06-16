import WebSocket from 'ws';
import zlib from 'zlib';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import yaml from 'yaml'
import path from 'path'

const keyPath = path.resolve(__dirname, '../../config/key.yaml');
const keyFile = fs.readFileSync(keyPath, 'utf8');
const keyYaml = yaml.parse(keyFile);
const keyVolc = keyYaml.tts.volcano;

const appid = keyVolc.appid;
const token = keyVolc.token;
const cluster = keyVolc.cluster;
const voice_type = 'zh_female_yuanqinvyou_moon_bigtts';
const host = 'openspeech.bytedance.com';
const api_url = `wss://${host}/api/v1/tts/ws_binary`;

const defaultHeader = Buffer.from([0x11, 0x10, 0x11, 0x00]);

const requestJson = {
  app: {
    appid,
    token,
    cluster,
  },
  user: {
    uid: '38880808'
  },
  audio: {
    voice_type: 'xxx',
    encoding: 'ogg_opus',
    speed_ratio: 1.0,
    volume_ratio: 1.0,
    pitch_ratio: 1.0
  },
  request: {
    reqid: 'xxx',
    text: '字节跳动语音合成。',
    operation: 'xxx'
  }
};

async function sendRequest(operation: 'submit' | 'query', filename: string) {
  const json = JSON.parse(JSON.stringify(requestJson));
  json.audio.voice_type = voice_type;
  json.request.reqid = uuidv4();
  json.request.operation = operation;

  const payload = zlib.gzipSync(Buffer.from(JSON.stringify(json), 'utf-8'));

  const fullRequest = Buffer.concat([
    defaultHeader,
    Buffer.alloc(4),
    payload
  ]);
  fullRequest.writeUInt32BE(payload.length, 4);

  const ws = new WebSocket(api_url, {
    headers: {
      Authorization: `Bearer; ${token}`
    }
  });

  const fileStream = fs.createWriteStream(filename);

  ws.on('open', () => {
    console.log(`Sending ${operation} request...`);
    ws.send(fullRequest);
  });

  ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
    if (!isBinary) {
      console.error(`should not recv text data: ${data.toString()}`);
      return;
    }
    const buffer = data as Buffer;
    const done = parseResponse(buffer, fileStream);
    if (done) {
      console.log('Closing WebSocket connection...');
      fileStream.end();
      ws.close();
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed.');
  });
}

function parseResponse(buffer: Buffer, file: fs.WriteStream): boolean {
  const protocolVersion = buffer[0] >> 4;
  const headerSize = buffer[0] & 0x0f;
  const messageType = buffer[1] >> 4;
  const flags = buffer[1] & 0x0f;
  const serialization = buffer[2] >> 4;
  const compression = buffer[2] & 0x0f;
  const payload = buffer.slice(headerSize * 4);

  if (messageType === 0x0b) {
    if (flags === 0) return false;
    const seq = buffer.readInt32BE(headerSize * 4);
    const payloadSize = buffer.readUInt32BE(headerSize * 4 + 4);
    const audioPayload = buffer.slice(headerSize * 4 + 8);
    file.write(audioPayload);
    return seq < 0;
  } else if (messageType === 0x0f) {
    const code = payload.readUInt32BE(0);
    const msgSize = payload.readUInt32BE(4);
    let errorMsg = payload.slice(8);
    if (compression === 1) {
      errorMsg = zlib.gunzipSync(errorMsg);
    }
    console.error('Error:', errorMsg.toString('utf-8'));
    return true;
  } else if (messageType === 0x0c) {
    let msg = payload.slice(4);
    if (compression === 1) {
      msg = zlib.gunzipSync(msg);
    }
    console.log('Frontend message:', msg.toString());
  } else {
    console.warn('Unknown message type:', messageType);
    return true;
  }

  return false;
}

// 主函数调用
(async () => {
  await sendRequest('submit', 'test_submit.ogg');
  // await sendRequest('query', 'test_query.ogg');
})();

