import fs from 'fs';
import yaml from 'yaml'
import path from 'path'
import util from 'util';

import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { OggPage } from './media';

const keyPath = path.resolve(__dirname, '../config/key.yaml');
const keyFile = fs.readFileSync(keyPath, 'utf8');
const keyYaml = yaml.parse(keyFile);
const keyVolc = keyYaml.tts.volcano;

const appid = keyVolc.appid;
const token = keyVolc.token;
// const default_voice_type = 'zh_female_yuanqinvyou_moon_bigtts';
const default_voice_type = 'zh_female_shuangkuaisisi_moon_bigtts';
const host = 'openspeech.bytedance.com';
const url = `wss://${host}/api/v3/tts/bidirection`;

enum MessageType {
  Request = 0x1,
  ResponseFull = 0x9,
  ResponseAudio = 0xb,
  Error = 0xf,
}
enum MessageFlag {
  None = 0x0,
  Event = 0x4,
}
enum MessageSerialization {
  None = 0x0,
  Json = 0x1,
}
enum MessageEvent {
  None = 0,
  // client connection event
  StartConnection = 1,
  FinishConnection = 2,
  // server connection event
  ConnectionStarted = 50,
  ConnectionFailed = 51,
  ConnectionFinished = 52,
  // client session event
  StartSession = 100,
  FinishSession = 102,
  // server session event
  SessionStarted = 150,
  SessionCanceled = 151,
  SessionFinished = 152,
  SessionFailed = 153,
  // client task event
  TaskRequest = 200,
  // server task event
  TTSSentenceStart = 350,
  TTSSentenceEnd = 351,
  TTSResponse = 352,
}

class MessageHeader {
  version = 1;
  headerSize = 1;
  type: MessageType = MessageType.Request;
  flag: MessageFlag = MessageFlag.None;
  serialization: MessageSerialization = MessageSerialization.Json;
  compression = 0;
  reserved = 0;

  constructor(init?: Partial<MessageHeader>) {
    Object.assign(this, init);
  }

  toBuffer(): Buffer {
    const b = Buffer.alloc(4);
    b[0] = (this.version << 4) | this.headerSize;
    b[1] = (this.type << 4) | this.flag;
    b[2] = (this.serialization << 4) | this.compression;
    b[3] = this.reserved;
    return b;
  }
}

class MessageOpt {
  event = MessageEvent.None;
  sessionId?: string;

  constructor(init?: Partial<MessageOpt>) {
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
    if (this.event !== MessageEvent.None) {
      parts.push(wb(this.event));
    }
    if (this.sessionId) {
      // string to buffer <size><string>
      const sidBuf = Buffer.from(this.sessionId, 'utf8');
      parts.push(wb(sidBuf.length));
      parts.push(sidBuf);
    }
    const res = Buffer.concat(parts);
    // console.log(`MessageOpt output event: ${this.event}, session: ${this.sessionId}, hex: ${res.toString('hex')}`);
    return res;
  }
}

class MessageServerOpt extends MessageOpt {
  errorCode?: number;
  connectionId?: string;
  responseMetaJson?: string;
}

class ResponseMessage {
  header: MessageHeader = new MessageHeader();
  opt: MessageServerOpt = new MessageServerOpt();
  payload?: Buffer;
  payloadJson?: string;

  // 解析服务端返回
  static parse(data: Buffer): ResponseMessage {
    const resp = new ResponseMessage();
    const h = resp.header;
    h.version = (data[0] >> 4) & 0x0f;
    h.headerSize = data[0] & 0x0f;
    h.type = (data[1] >> 4) & 0x0f;
    h.flag = data[1] & 0x0f;
    h.serialization = (data[2] >> 4) & 0x0f;
    h.compression = data[2] & 0x0f;
    h.reserved = data[3];
    if (h.version !== 1) {
      console.warn(`Unsupported protocol version: ${h.version}`);
      return resp; // 直接返回空响应
    }
    if (h.compression !== 0) {
      console.warn(`Unsupported compression type: ${h.compression}`);
      return resp; // 直接返回空响应
    }

    // 这个是读取的光标，header 占用 4。
    let offset = 4;
    const opt = resp.opt;

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

    if (h.type === MessageType.ResponseFull
        || h.type === MessageType.ResponseAudio) {
      if (h.flag !== MessageFlag.Event) {
        console.warn(`Unexpected messageTypeFlags: ${h.flag}`);
        return resp; // 直接返回空响应
      }
      opt.event = data.readInt32BE(offset);
      offset += 4;
      // console.log(`Response event: ${opt.event}`);
      switch (opt.event) {
        case MessageEvent.ConnectionStarted:
          opt.connectionId = readString();
          break;
        case MessageEvent.ConnectionFailed:
          opt.responseMetaJson = readString();
          break;
        case MessageEvent.SessionStarted:
        case MessageEvent.SessionFailed:
        case MessageEvent.SessionFinished:
          opt.sessionId = readString();
          opt.responseMetaJson = readString();
          break;
        case MessageEvent.TTSResponse:
          opt.sessionId = readString();
          resp.payload = readPayload();
          break;
        case MessageEvent.TTSSentenceStart:
        case MessageEvent.TTSSentenceEnd:
          opt.sessionId = readString();
          resp.payloadJson = readString();
          break;
      }
    } else if (h.type === MessageType.Error) {
      opt.errorCode = data.readInt32BE(offset);
      offset += 4;
      resp.payload = readPayload();
    } else {
      console.warn(`Unknown message type: ${h.type}`);
      return resp; // 直接返回空响应
    }
    return resp;
  }
}

class RequestMessage {
  header?: MessageHeader;
  opt?: MessageOpt;
  payloadJson: string = '{}';

  setHeader(h: MessageHeader) { this.header = h; }
  setOpt(o: MessageOpt) { this.opt = o; }

  newHeader(init?: Partial<MessageHeader>) {
    this.header = new MessageHeader(init);
  }
  newOpt(init?: Partial<MessageOpt>) {
    this.opt = new MessageOpt(init);
  }
  newPayload(opts: {
      uid?: string; event: number;
      text?: string; speaker?: string;
  }) {
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
    this.payloadJson = JSON.stringify(p);
  }

  toBuffer(): Buffer {
    if (this.header == null || this.opt == null) {
      throw new Error('Header and Opt must be set before converting to buffer.');
    }
    const headerBuf = this.header.toBuffer();
    const optBuf = this.opt.toBuffer();
    const payloadBuf = Buffer.from(this.payloadJson, 'utf8');
    const lenBuf = Buffer.alloc(4); // length prefix
    lenBuf.writeUInt32BE(payloadBuf.length, 0);
    const pkt = Buffer.concat([
      headerBuf,
      optBuf,
      lenBuf,
      payloadBuf
    ]);
    // console.log(`Request payload: ${this.payloadJson}`);
    // console.log(`Sending packet: ${pkt.toString('hex')}`);
    return pkt;
  }
}

export type TTSWord = {
  word: string;
  startTime: number; // in seconds
  endTime: number; // in seconds
  confidence: number;
};
export type TTSSentence = {
  text: string;
  words: TTSWord[];
  phonemes: string[];
};
export type TTSDeltaHook = (delta: Buffer | null) => void;
export type TTSSentenceHook = (sentence: TTSSentence, begin: boolean) => void;
enum TTSStreamStatus {
  Closed = 0,
  Opening = 1,
  Opened = 2,
  Closing = 3,
};

/**
  * TTSStreamVolcano 类用于与火山引擎的双向 TTS 服务进行交互。
  * 它支持设置说话人、添加文本、开始和结束会话，并接收音频数据流。
  * 这个双向流式 TTS 服务允许实时发送文本并接收音频数据。
  * 流式输入可以支持一个一个字的输入，但是合成的效果不如一次次输入句子来得好。
  *
  * 在 'ogg_opus' 格式下，音频数据是 Opus 编码的 OGG 格式。
  * 每一次流式输出都会得到很多个 Opus Page，
  * 然后触发 onDeltaHook 回调函数。
  *
  * 火山引擎输出的 Opus Frame 在多次 addText 的文件时长编码上面有一些问题。
  * 现在 Opus Page 的 Granule Position 的取值不正确。
  * 导致 ffprobe 解析时无法正确获取音频时长。
  * VLC 播放器可以正常播放，但是 Windows Media Player 无法播放。
  */
export class TTSStreamVolcano {
  private speaker: string = default_voice_type;
  private onDeltaHook?: TTSDeltaHook;
  private onSentenceHook?: TTSSentenceHook;
  private ws?: WebSocket;
  private sessionId?: string;
  private inputCache: string[] = [];

  private state = TTSStreamStatus.Closed;
  private sessionFinishHook: () => void = () => {};
  private outputChunks: Buffer[] = [];

  setSpeaker(speaker: string) {
    this.speaker = speaker;
  }
  setOnDeltaHook(hook: TTSDeltaHook) {
    this.onDeltaHook = hook;
  }
  setOnSentenceHook(hook: TTSSentenceHook) {
    this.onSentenceHook = hook;
  }

  /**
    * 火山引擎的双向 TTS 服务需要先建立 WebSocket 连接，
    * 使用规则是一个连接只能处理一个会话。
    * 因此每次调用 beginSession 都会创建一个新的 WebSocket 连接。
    * 每个会话用 endSession 结束之后，等待 TTS 音频数据流结束，
    * 然后调用 waitFinish 获取完整的音频数据。
    * 下次要使用时需要重新调用 beginSession。
    * 注意：如果在同一个 WebSocket 连接中多次调用 beginSession，会导致之前的会话被中断。
    *
    * TODO: 生产代码里面需要处理超时和错误情况，在 on message 里面累积的错误需要在 waitFinish 里面报告出来。
    */
  async beginSession() {
    return new Promise<string>(async (resolve, reject) => {
      this.sessionId = uuidv4().replace(/-/g, '');
      this.state = TTSStreamStatus.Opening;
      this.ws = new WebSocket(url, {
        headers: {
          "X-Api-App-Key": appid,
          "X-Api-Access-Key": token,
          "X-Api-Resource-Id": 'volc.service_type.10029',
          "X-Api-Connect-Id": this.sessionId,
        },
      });
      // 确保任何出错都能触发 reject，不会长期等待。
      this.setWsReject(reject);
      // wait for WebSocket to open
      await new Promise<void>((resolve) => {
        this.ws!.on('open', () => resolve());
      });
      this.sendConnStart();
      let resp = await this.recvResponse();
      if (resp.opt.event !== MessageEvent.ConnectionStarted)
        throw new Error("start connection failed");
      this.sendSessionStart(this.sessionId!);
      resp = await this.recvResponse();
      if (resp.opt.event !== MessageEvent.SessionStarted)
        throw new Error("start session failed");
      console.log(`WebSocket session started: ${resp.opt.sessionId}`);

      // set audio data handler
      this.ws.on('message', (data: WebSocket.RawData) => {
        if (!Buffer.isBuffer(data)) {
          reject(new Error('Received non-buffer data from WebSocket.'));
        }
        const resp = ResponseMessage.parse(data as Buffer);
        if (resp.opt.event === MessageEvent.TTSSentenceStart
            || resp.opt.event === MessageEvent.TTSSentenceEnd) {
          if (resp.payloadJson != null && this.onSentenceHook) {
            const sentence: TTSSentence = JSON.parse(resp.payloadJson);
            // TODO: add zod format check.
            this.onSentenceHook(sentence, resp.opt.event === MessageEvent.TTSSentenceStart);
          }
        } else if (resp.opt.event === MessageEvent.TTSResponse) {
          const buf = resp.payload;
          if (buf == null) return; // no audio data, continue
          if (this.onDeltaHook) this.onDeltaHook(buf);
          this.outputChunks.push(buf);

          // bytes header should be 'OggS'.
          const bytesHeader = buf.subarray(0, 4).toString('ascii');
          if (bytesHeader !== 'OggS') {
            console.warn(`Received unexpected bytes header: ${bytesHeader}`);
            return; // not a valid Ogg page, skip
          }
          console.log(`Received TTS audio data: ${buf.length} bytes`);
          // try {
          //   const page = OggPage.parse(buf);
          //   console.log(`Parsed Ogg page: ${util.inspect(page, {depth: 1})}`);
          // } catch (err) {
          //   console.error(`Failed to parse Ogg page: ${err}`);
          // }

        } else if (resp.opt.event === MessageEvent.SessionFinished) {
          console.log(`Session finished: ${resp.opt.sessionId}`);
          this.sessionFinishedCheck();
        } else if (resp.opt.event === MessageEvent.SessionFailed) {
          console.error(`Session failed: ${resp.opt.responseMetaJson}`);
          this.sessionFinishedCheck();
          this.closeWs();
        } else if (resp.opt.event === MessageEvent.ConnectionFailed) {
          console.error(`Connection failed: ${resp.opt.responseMetaJson}`);
          this.sessionFinishedCheck();
          this.closeWs();
        } else if (resp.opt.event === MessageEvent.ConnectionFinished) {
          this.sessionFinishedCheck();
          this.closeWs();
        } else {
          console.warn(`Received unknown event: ${resp.opt.event}`);
        }
      });
      this.state = TTSStreamStatus.Opened;
      resolve(this.sessionId);
      // 刷新输入缓存
      await this.sendTaskRequest(this.sessionId, this.inputCache.join(''));
      this.inputCache = [];
    });
  }
  async addText(word: string) {
    if (this.state === TTSStreamStatus.Closed) {
      throw new Error('WebSocket session is not started.');
    }
    if (this.state !== TTSStreamStatus.Opened) {
      this.inputCache.push(word);
      return;
    }
    // send task request
    await this.sendTaskRequest(this.sessionId!, word);
  }
  async endSession() {
    if (this.ws == null) return;
    await this.sendFinishSession(this.sessionId!);
  }
  async waitFinish(): Promise<Buffer> {
    if (this.ws == null) return Buffer.alloc(0);
    if (this.state === TTSStreamStatus.Opened) {
      await new Promise<void>((resolve, reject) => {
        this.setWsReject(reject);
        this.sessionFinishHook = resolve;
      });
      this.sessionFinishHook = () => {}; // 清除钩子，避免重复调用
    }
    await this.sendFinishConnection();
    this.closeWs();
    return Buffer.concat(this.outputChunks);
  }
  close() {
    this.closeWs();
  }

  // 这个函数的用意是在调用 async 的地方确保任何出错都能触发 reject，不会长期等待。
  private setWsReject(reject: (reason?: Error) => void) {
    // 对于 Error 事件，直接关闭连接。
    this.ws!.once('error', err => {
      console.error('WebSocket error:', err);
      this.closeWs();
      reject(err);
    });
    this.ws!.once('close', () => {
      this.closeWs();
      reject(new Error('WebSocket connection closed unexpectedly.'));
    });
  }

  private sessionFinishedCheck() {
    if (this.state === TTSStreamStatus.Opened && this.onDeltaHook) {
      this.onDeltaHook(null);
    }
    this.state = TTSStreamStatus.Closing;
    this.sessionFinishHook();
  }

  private closeWs() {
    this.ws?.close();
    this.ws = undefined;
    this.sessionId = undefined;
    this.state = TTSStreamStatus.Closed;
  }

  private sendConnStart() {
    const req = new RequestMessage();
    req.newHeader({type: MessageType.Request, flag: MessageFlag.Event});
    req.newOpt({event: MessageEvent.StartConnection});
    return this.sendRequest(req);
  };

  private sendSessionStart(sessionId: string): Promise<void> {
    const req = new RequestMessage();
    req.newHeader({
      type: MessageType.Request, flag: MessageFlag.Event, serialization: MessageSerialization.Json});
    req.newOpt({event: MessageEvent.StartSession, sessionId});
    req.newPayload({event: MessageEvent.StartSession, speaker: this.speaker});
    return this.sendRequest(req);
  }

  private sendTaskRequest(sessionId: string, text: string): Promise<void> {
    const req = new RequestMessage();
    req.newHeader({
      type: MessageType.Request, flag: MessageFlag.Event, serialization: MessageSerialization.Json});
    req.newOpt({event: MessageEvent.TaskRequest, sessionId});
    req.newPayload({event: MessageEvent.TaskRequest, text, speaker: this.speaker});
    return this.sendRequest(req);
  }

  private sendFinishSession(sessionId: string): Promise<void> {
    if (this.ws == null) {
      return Promise.resolve(); // 如果没有连接，直接返回
    }
    const req = new RequestMessage();
    req.newHeader({
      type: MessageType.Request, flag: MessageFlag.Event, serialization: MessageSerialization.Json});
    req.newOpt({event: MessageEvent.FinishSession, sessionId});
    return this.sendRequest(req);
  }

  private sendFinishConnection(): Promise<void> {
    if (this.ws == null) {
      return Promise.resolve(); // 如果没有连接，直接返回
    }
    const req = new RequestMessage();
    req.newHeader({
      type: MessageType.Request, flag: MessageFlag.Event, serialization: MessageSerialization.Json});
    req.newOpt({event: MessageEvent.FinishConnection});
    return this.sendRequest(req);
  }

  private async sendRequest(
    req: RequestMessage,
  ): Promise<void> {
    if (this.ws == null) {
      throw new Error('WebSocket connection is not established.');
    }
    return this.ws.send(req.toBuffer());
  }

  private async recvResponse(): Promise<ResponseMessage> {
    return new Promise<ResponseMessage>((resolve, reject) => {
      if (this.ws == null) {
        throw new Error('WebSocket connection is not established.');
      }
      this.ws.once('message', (data: WebSocket.RawData) => {
        if (!Buffer.isBuffer(data)) {
          reject(new Error('Received non-buffer data from WebSocket.'));
        }
        const buffer = data as Buffer;
        const msg = ResponseMessage.parse(buffer);
        // console.log(`Received response: ${JSON.stringify(msg)}`);
        resolve(msg);
      });
    });
  }
}

