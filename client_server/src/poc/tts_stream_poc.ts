import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

// Constants（参照原 demo）
const PROTOCOL_VERSION = 0b0001;
const DEFAULT_HEADER_SIZE = 0b0001;
// Message Type
const FULL_CLIENT_REQUEST = 0b0001;
const AUDIO_ONLY_RESPONSE = 0b1011;
const FULL_SERVER_RESPONSE = 0b1001;
const ERROR_INFORMATION = 0b1111;
// Flags
const MsgTypeFlagWithEvent = 0b100;
// Serialization/compression
const NO_SERIALIZATION = 0b0000;
const JSON_SERIAL = 0b0001;
const COMPRESSION_NO = 0b0000;

// Events
const EVENT_NONE = 0;
// client connection event
const EVENT_StartConnection = 1;
const EVENT_FinishConnection = 2;
// server connection event
const EVENT_ConnectionStarted = 50;
const EVENT_ConnectionFailed = 51;
// client session event
const EVENT_StartSession = 100;
const EVENT_FinishSession = 102;
// server session event
const EVENT_SessionStarted = 150;
const EVENT_SessionCanceled = 151;
const EVENT_SessionFinished = 152;
const EVENT_SessionFailed = 153;
// client task event
const EVENT_TaskRequest = 200;
// server task event
const EVENT_TTSSentenceStart = 350;
const EVENT_TTSSentenceEnd = 351;
const EVENT_TTSResponse = 352;

class Header {
  protocolVersion = PROTOCOL_VERSION;
  headerSize = DEFAULT_HEADER_SIZE;
  messageType = 0;
  messageTypeFlags = 0;
  serialMethod = NO_SERIALIZATION;
  compressionType = COMPRESSION_NO;
  reserved = 0;

  constructor(init?: Partial<Header>) {
    Object.assign(this, init);
  }

  toBuffer(): Buffer {
    const b = Buffer.alloc(4);
    b[0] = (this.protocolVersion << 4) | this.headerSize;
    b[1] = (this.messageType << 4) | this.messageTypeFlags;
    b[2] = (this.serialMethod << 4) | this.compressionType;
    b[3] = this.reserved;
    return b;
  }
}

class OptionalField {
  event = EVENT_NONE;
  sessionId?: string;

  constructor(init?: Partial<OptionalField>) {
    if (init) Object.assign(this, init);
  }

  toBuffer(): Buffer {
    const parts: Buffer[] = [];
    // push a big-endian 32-bit integer
    const wb = (n: number) => {
      const buf = Buffer.alloc(4);
      buf.writeInt32BE(n);
      return buf;
    };
    if (this.event && this.event !== EVENT_NONE) {
      parts.push(wb(this.event));
    }
    if (this.sessionId) {
      // 将 sessionId 转换为 Buffer
      const sidBuf = Buffer.from(this.sessionId, 'utf8');
      parts.push(wb(sidBuf.length));
      parts.push(sidBuf);
    }
    const res = Buffer.concat(parts);
    console.log(`OptionalField event: ${this.event}, hex: ${res.toString('hex')}`);
    return res;
  }
}

class ServerOptionalField extends OptionalField {
  errorCode?: number;
  connectionId?: string;
  responseMetaJson?: string;
}

interface Response {
  header: Header;
  optional: ServerOptionalField;
  payload?: Buffer;
  payloadJson?: string;
}

// 解析服务端返回
function parseResponse(data: Buffer): Response {
  const resp: Response = {
    header: new Header(),
    optional: new ServerOptionalField()
  };
  const h = resp.header;
  h.protocolVersion = (data[0] >> 4) & 0x0f;
  h.headerSize = data[0] & 0x0f;
  h.messageType = (data[1] >> 4) & 0x0f;
  h.messageTypeFlags = data[1] & 0x0f;
  h.serialMethod = (data[2] >> 4) & 0x0f;
  h.compressionType = data[2] & 0x0f;
  h.reserved = data[3];
  
  // 这个是读取的光标，header 占用 4。
  let offset = 4;
  const opt = resp.optional;

  // read a string field from buffer.
  const readString = (): string => {
    const len = data.readInt32BE(offset);
    offset += 4;
    const s = data.subarray(offset, offset + len).toString('utf8');
    offset += len;
    return s;
  };

  // read a binary payload from buffer.
  const readPayload = (): Buffer => {
    const len = data.readInt32BE(offset);
    offset += 4;
    const buf = data.subarray(offset, offset + len);
    offset += len;
    return buf;
  };

  if (h.messageType === FULL_SERVER_RESPONSE || h.messageType === AUDIO_ONLY_RESPONSE) {
    if (h.messageTypeFlags !== MsgTypeFlagWithEvent) {
      console.warn(`Unexpected messageTypeFlags: ${h.messageTypeFlags}`);
      return resp; // 直接返回空响应
    }
    opt.event = data.readInt32BE(offset);
    offset += 4;
    switch (opt.event) {
      case EVENT_ConnectionStarted:
        opt.connectionId = readString();
        break;
      case EVENT_ConnectionFailed:
        opt.responseMetaJson = readString();
        break;
      case EVENT_SessionStarted:
      case EVENT_SessionFailed:
      case EVENT_SessionFinished:
        opt.sessionId = readString();
        opt.responseMetaJson = readString();
        break;
      case EVENT_TTSResponse:
        opt.sessionId = readString();
        resp.payload = readPayload();
        break;
      case EVENT_TTSSentenceStart:
      case EVENT_TTSSentenceEnd:
        opt.sessionId = readString();
        resp.payloadJson = readString();
        break;
    }
  } else if (h.messageType === ERROR_INFORMATION) {
    opt.errorCode = data.readInt32BE(offset);
    offset += 4;
    resp.payload = readPayload();
  } else {
    console.warn(`Unknown message type: ${h.messageType}`);
    return resp; // 直接返回空响应
  }
  return resp;
}

// 构造 payload JSON
function makePayloadBytes(opts: {
  uid?: string;
  event: number;
  text?: string;
  speaker?: string;
}): Buffer {
  const p = {
    user: { uid: opts.uid ?? '1234' },
    event: opts.event,
    namespace: "BidirectionalTTS",
    req_params: {
      text: opts.text ?? '',
      speaker: opts.speaker ?? '',
      audio_params: {
        format: 'ogg_opus',
        sample_rate: 24000,
        enable_timestamp: true,
      }
    }
  };
  const str = JSON.stringify(p);
  console.log('Request payload:', str);
  return Buffer.from(str, 'utf8');
}

// 通用发送函数
async function sendEvent(
  ws: WebSocket,
  headerBuf: Buffer,
  optionalBuf: Buffer,
  payloadBuf: Buffer
): Promise<void> {
  const lenBuf = Buffer.alloc(4); // length prefix
  lenBuf.writeUInt32BE(payloadBuf.length, 0);
  const pkt = Buffer.concat([
    headerBuf,
    optionalBuf,
    lenBuf,
    payloadBuf
  ]);
  // print packet in hex
  console.log('Sending packet:', pkt.toString('hex'));
  return new Promise((resolve, reject) => {
    ws.send(pkt, err => err ? reject(err) : resolve());
  });
}

async function runDemo(
  appId: string,
  token: string,
  speaker: string,
  text: string,
  outputPath: string
) {
  const ws = new WebSocket('wss://openspeech.bytedance.com/api/v3/tts/bidirection', {
    headers: {
      "X-Api-App-Key": appId,
      "X-Api-Access-Key": token,
      "X-Api-Resource-Id": 'volc.service_type.10029',
      "X-Api-Connect-Id": uuidv4(),
    },
    maxPayload: 1e9
  });

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', e => reject(e));
  });
  const emptyJson = Buffer.from('{}', 'utf8');
  // console.log('emptyJson:', emptyJson.toString('hex'));

  const sendConnStart = () => {
    const h = new Header({messageType: FULL_CLIENT_REQUEST, messageTypeFlags: MsgTypeFlagWithEvent});
    const o = new OptionalField({event: EVENT_StartConnection});
    return sendEvent(ws, h.toBuffer(), o.toBuffer(), emptyJson);
  };

  const sendSessionStart = (sessionId: string) => {
    const h = new Header({messageType: FULL_CLIENT_REQUEST, messageTypeFlags: MsgTypeFlagWithEvent, serialMethod: JSON_SERIAL});
    const o = new OptionalField({event: EVENT_StartSession, sessionId});
    const p = makePayloadBytes({event: EVENT_StartSession, speaker});
    return sendEvent(ws, h.toBuffer(), o.toBuffer(), p);
  };

  const sendTaskRequest = (sessionId: string) => {
    const h = new Header({messageType: FULL_CLIENT_REQUEST, messageTypeFlags: MsgTypeFlagWithEvent, serialMethod: JSON_SERIAL});
    const o = new OptionalField({event: EVENT_TaskRequest, sessionId});
    const p = makePayloadBytes({event: EVENT_TaskRequest, text, speaker});
    return sendEvent(ws, h.toBuffer(), o.toBuffer(), p);
  };

  const sendFinishSession = (sessionId: string) => {
    const h = new Header({messageType: FULL_CLIENT_REQUEST, messageTypeFlags: MsgTypeFlagWithEvent, serialMethod: JSON_SERIAL});
    const o = new OptionalField({event: EVENT_FinishSession, sessionId});
    return sendEvent(ws, h.toBuffer(), o.toBuffer(), Buffer.from('{}', 'utf8'));
  };

  const sendFinishConnection = () => {
    const h = new Header({messageType: FULL_CLIENT_REQUEST, messageTypeFlags: MsgTypeFlagWithEvent, serialMethod: JSON_SERIAL});
    const o = new OptionalField({event: EVENT_FinishConnection});
    return sendEvent(ws, h.toBuffer(), o.toBuffer(), Buffer.from('{}', 'utf8'));
  };

  const recv = (): Promise<Response> => new Promise((resolve, reject) => {
    ws.once('message', data => {
      if (data instanceof Buffer) {
        // print data in hex
        console.log('Received data:', data.toString('hex'));
        resolve(parseResponse(data));
      } else reject(new Error('Expected buffer'));
    });
  });

  // Start connection
  sendConnStart();
  let res = await recv();
  console.log('start_connection response:', res);
  if (res.optional.event !== EVENT_ConnectionStarted) throw new Error("start connection failed");

  // Start session
  const sessionId = uuidv4().replace(/-/g, '');
  await sendSessionStart(sessionId);
  res = await recv();
  console.log('start_session response:', res);
  if (res.optional.event !== EVENT_SessionStarted) throw new Error("start session failed");

  // Send text, finish session
  await sendTaskRequest(sessionId);
  await sendFinishSession(sessionId);

  const outBuffers: Buffer[] = [];
  while (true) {
    res = await recv();
    console.log('response:', res.optional.event, res.header.messageType);
    if (res.optional.event === EVENT_TTSResponse && res.header.messageType === AUDIO_ONLY_RESPONSE && res.payload) {
      outBuffers.push(res.payload);
    } else if ([EVENT_TTSSentenceStart, EVENT_TTSSentenceEnd].includes(res.optional.event)) {
      // 这个是句子开始或结束事件，通常不需要处理
      console.log(`Received event: ${res.optional.event}, payload: ${res.payloadJson}`);
      continue;
    } else {
      break;
    }
  }
  await fs.promises.writeFile(outputPath, Buffer.concat(outBuffers));
  console.log('audio saved to', outputPath);

  await sendFinishConnection();
  res = await recv();
  console.log('finish_connection response:', res);
  ws.close();
}

import yaml from 'yaml'
import path from 'path'

const keyPath = path.resolve(__dirname, '../../config/key.yaml');
const keyFile = fs.readFileSync(keyPath, 'utf8');
const keyYaml = yaml.parse(keyFile);
const keyVolc = keyYaml.tts.volcano;

const appid = keyVolc.appid;
const token = keyVolc.token;
(async () => {
  const speaker = 'zh_female_shuangkuaisisi_moon_bigtts';
  // const text = '明朝开国皇帝朱元璋也称这本书为,万物之根';
  const text = '你好';
  const outputPath = __dirname + '/../../data/tts/双向流式tts.mp3';
  await runDemo(appid, token, speaker, text, outputPath);
})();

