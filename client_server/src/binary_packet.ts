// 这个文件定义了二进制数据包的结构和处理方法
// 包含头部信息和数据内容的类
// BinaryPacketHeader 用于解析和构建数据包头部
// BinaryPacket 用于解析和构建完整的数据包

import fs from 'fs';
import path from 'path';
import { OpusDecoder, OpusDecoderSampleRate } from 'opus-decoder';
import { convertWavToOpusOgg } from './media';

// 定义 BOSIZE_UNKNOWN 常量，表示未知大小
const BOSIZE_UNKNOWN = 0xFFFFFFFF;

export enum BOType {
    RawText = 0x01,     // 原始文本
    AudioOpus = 0x10,   // 音频数据（Opus 编码）
    AudioOpusFrame = 0x11,  // 音频数据帧（Opus 编码）
    AudioWav = 0x12,    // 音频数据（Wav 编码）
    ImageJpeg = 0x20,   // 图像数据（JPEG 编码）
}

// 正向映射：Enum Value → String 名称
export function BOTypeToString(value: BOType): string {
  switch (value) {
    case BOType.RawText: return "RawText";
    case BOType.AudioOpus: return "AudioOpus";
    case BOType.AudioOpusFrame: return "AudioOpusFrame";
    case BOType.AudioWav: return "AudioWav";
    case BOType.ImageJpeg: return "ImageJpeg";
    default: return `Unknown(${value})`;
  }
}

// 反向映射：字符串名称 → Enum Value
export function BOTypeFromString(name: string): BOType | undefined {
  switch (name) {
    case "RawText": return BOType.RawText;
    case "AudioOpus": return BOType.AudioOpus;
    case "AudioOpusFrame": return BOType.AudioOpusFrame;
    case "AudioWav": return BOType.AudioWav;
    case "ImageJpeg": return BOType.ImageJpeg;
    default: return undefined;
  }
}

export class Snowflake {
  static readonly EPOCH_FROM = 1609459200000n; // 2021-01-01T00:00:00Z 的时间戳
  machineId = 1n; // 机器 ID，假设为 1
  lastTimestamp = 0n; // 上次生成 ID 的时间戳
  lastSequence = 0n; // 序列号，初始为 0

  constructor(machineId: number) {
    this.machineId = BigInt(machineId);
  }
  /** 生成一个新的 Snowflake ID */
  generate(): bigint {
    let now = BigInt(Date.now()) - Snowflake.EPOCH_FROM; // 获取当前时间戳，减去 EPOCH_FROM 以适应 Snowflake 格式
    if (now < this.lastTimestamp) {
      now = this.lastTimestamp; // 如果当前时间戳小于上次生成的时间戳，保持不变
    }
    if (now === this.lastTimestamp) {
      this.lastSequence = (this.lastSequence + 1n) & 0xFFFn; // 序列号循环，最大值为 4095
      if (this.lastSequence === 0n) {
        // 如果序列号回绕到 0，进位下一毫秒
        now += 1n;
      }
    } else {
      this.lastSequence = 0n; // 如果时间戳变化，重置序列号
    }
    this.lastTimestamp = now;
    // 生成 Snowflake ID：timestamp (22 bits) + machineId (10 bits) + sequence (12 bits)
    return (now << 22n) | (this.machineId << 12n) | this.lastSequence;
  }

  static parse(id: bigint): { timestamp: bigint, machineId: number, sequence: number } {
    const timestamp = (id >> 22n) + Snowflake.EPOCH_FROM; // 获取时间戳并加上 EPOCH_FROM
    const machineId = Number((id >> 12n) & 0x3FFn); // 假设机器 ID 占 10 位
    const sequence = Number(id & 0xFFFn); // 序列号占 12 位
    return { timestamp, machineId, sequence };
  }
  static parseToReadable(id: bigint): { timestamp: Date, machineId: number, sequence: number } {
    const parsed = Snowflake.parse(id);
    return {
      timestamp: new Date(Number(parsed.timestamp)),
      machineId: parsed.machineId,
      sequence: parsed.sequence
    };
  }
}

export class BinaryPacketHeader {
  bosid: bigint = 0n;        // 8 bytes
  size: number = 0;          // 4 bytes
  offset: number = 0;        // 4 bytes
  frameSize: number = 0;     // 2 bytes
  isLastFrame: number = 0;   // 1 byte
  type: BOType = BOType.RawText; // 1 byte

  static readonly HEADER_SIZE = 20;

  /** 从 Buffer 中解包 */
  static fromBuffer(buffer: Buffer): BinaryPacketHeader {
    if (buffer.length < BinaryPacketHeader.HEADER_SIZE) {
      throw new Error("Buffer too small to contain BinaryPacketHeader");
    }

    const header = new BinaryPacketHeader();
    header.bosid = buffer.readBigUInt64BE(0);
    header.size = buffer.readUInt32BE(8);
    header.offset = buffer.readUInt32BE(12);
    header.frameSize = buffer.readUInt16BE(16);
    header.isLastFrame = buffer.readUInt8(18);
    header.type = buffer.readUInt8(19);
    return header;
  }

  /** 将 header 转换为 Buffer */
  toBuffer(): Buffer {
    const buffer = Buffer.alloc(BinaryPacketHeader.HEADER_SIZE);

    buffer.writeBigUInt64BE(this.bosid, 0);       // offset 0
    buffer.writeUInt32BE(this.size, 8);           // offset 8
    buffer.writeUInt32BE(this.offset, 12);        // offset 12
    buffer.writeUInt16BE(this.frameSize, 16);     // offset 16
    buffer.writeUInt8(this.isLastFrame, 18);      // offset 18
    buffer.writeUInt8(this.type, 19);             // offset 19

    return buffer;
  }

  /** 用于调试输出 JSON */
  toJSON() {
    return {
      bosid: this.bosid.toString(),
      bosid_meaning: Snowflake.parseToReadable(this.bosid),
      size: this.size,
      offset: this.offset,
      frameSize: this.frameSize,
      isLastFrame: this.isLastFrame,
      type: this.type
    };
  }
}

export class BinaryPacket {
    header: BinaryPacketHeader;
    data: Buffer;
    
    constructor(header: BinaryPacketHeader, data: Buffer) {
        this.header = header;
        this.data = data;
    }
    
    /** 将 BinaryPacket 转换为 Buffer */
    toBuffer(): Buffer {
        const headerBuf = this.header.toBuffer();
        return Buffer.concat([headerBuf, this.data]);
    }
    
    /** 从 Buffer 中解包 */
    static fromBuffer(buffer: Buffer): BinaryPacket {
        const header = BinaryPacketHeader.fromBuffer(buffer);
        const data = buffer.subarray(BinaryPacketHeader.HEADER_SIZE);
        return new BinaryPacket(header, data);
    }
    
    /** 用于调试输出 JSON */
    toJSON() {
        return {
            header: this.header.toJSON(),
            data: this.data.toString('hex') // 或者其他格式
        };
    }
};

const validSampleRates: OpusDecoderSampleRate[] = [8000, 12000, 16000, 24000, 48000];
function isValidOpusSampleRate(rate: number): rate is OpusDecoderSampleRate {
  return validSampleRates.includes(rate as OpusDecoderSampleRate);
}

export class AudioDecoder {
  sampleRate: OpusDecoderSampleRate = 16000;
  channels: number = 1;
  decoder: OpusDecoder<OpusDecoderSampleRate>;
  constructor(sampleRate: number, channels: number) {
    if (isValidOpusSampleRate(sampleRate)) {
      this.sampleRate = sampleRate;
    } else {
      console.error(`invalid sample rate ${sampleRate}, default to ${this.sampleRate}`);
    }
    this.channels = channels;
    this.decoder = new OpusDecoder({
      sampleRate: this.sampleRate,
      channels: this.channels,
    });
  }
  async ready() {
    await this.decoder.ready;
  }
  free(): void {
    this.decoder.free();
  }
  decodeFrame(frame: Buffer): Buffer {
    const {channelData, samplesDecoded, sampleRate} = this.decoder.decodeFrame(frame);
    console.log(`opus decoder: cnt=${samplesDecoded}, rate=${sampleRate}`);
    return this.float32ToInt16Buffer(channelData[0]);
  }
  packWav(pcmData: Buffer): Buffer {
    const bytesPerSample = 2;
    const blockAlign = this.channels * bytesPerSample;
    const byteRate = this.sampleRate * blockAlign;
    const dataSize = pcmData.length;
    const buffer = Buffer.alloc(44 + dataSize);

    // RIFF header
    buffer.write("RIFF", 0); // ChunkID
    buffer.writeUInt32LE(36 + dataSize, 4); // ChunkSize
    buffer.write("WAVE", 8); // Format

    // fmt subchunk
    buffer.write("fmt ", 12); // Subchunk1ID
    buffer.writeUInt32LE(16, 16); // Subchunk1Size
    buffer.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
    buffer.writeUInt16LE(this.channels, 22); // NumChannels
    buffer.writeUInt32LE(this.sampleRate, 24); // SampleRate
    buffer.writeUInt32LE(byteRate, 28); // ByteRate
    buffer.writeUInt16LE(blockAlign, 32); // BlockAlign
    buffer.writeUInt16LE(16, 34); // BitsPerSample

    // data subchunk
    buffer.write("data", 36); // Subchunk2ID
    buffer.writeUInt32LE(dataSize, 40); // Subchunk2Size

    // PCM data
    pcmData.copy(buffer, 44);
    return buffer;
  }

  private float32ToInt16Buffer(f32Samples: Float32Array): Buffer {
    const buffer = Buffer.alloc(f32Samples.length * 2); // 2 bytes per sample
    for (let i = 0; i < f32Samples.length; i++) {
      let sample = f32Samples[i];
      sample = Math.max(-1, Math.min(1, sample)); // 限制范围 [-1, 1]
      const int16 = Math.round(sample * 32767); // 转换为 Int16
      buffer.writeInt16LE(int16, i * 2);
    }
    return buffer;
  }
}

export class BinaryObject {
  bosid: bigint = 0n;
  type: BOType = BOType.RawText; // 默认类型为 RawText
  size: number = 0;
  cursor: number = 0;
  buf: Buffer = Buffer.alloc(0); // 初始为空 Buffer
  decoder: undefined | AudioDecoder = undefined;

  fromHeader(header: BinaryPacketHeader): void {
    this.bosid = header.bosid;
    this.type = header.type;
    this.size = header.size;
    this.init_alloc();
  }

  fromProps(bosid: bigint, type: BOType, size: number): void {
    this.bosid = bosid;
    this.type = type;
    this.size = size;
    this.init_alloc();
  }

  async fromFile(bosid: bigint, type: BOType, filePath: string): Promise<void> {
    this.bosid = bosid;
    this.type = type;
    // read file returns a Promise
    try {
      const fileBuffer = await fs.promises.readFile(filePath);
      this.size = fileBuffer.length;
      this.init_alloc();
      this.appendDataRaw(fileBuffer);
    } catch (err) {
      console.error(`Failed to read file ${filePath}:`, err);
      throw err; // 重新抛出错误以便调用者处理
    }
  }

  private init_alloc(): void {
    // 如果 size 是未知的，使用一个初始容量
    if (this.size === BOSIZE_UNKNOWN) {
      this.buf = Buffer.alloc(64);
    } else {
      this.buf = Buffer.alloc(this.size);
    }
  }

  async enableAudioConversion(sampleRate: number, channels: number) {
    // TODO: 这里目前暂时把 AudioOpus 也加上转码了，因为有些客户端的二进制代码没刷新。
    if (this.type === BOType.AudioOpusFrame
        || this.type === BOType.AudioOpus) {
      this.type = BOType.AudioWav;
      this.size = BOSIZE_UNKNOWN;
      this.decoder = new AudioDecoder(sampleRate, channels);
      await this.decoder.ready();
    }
  }
  
  disableAudioConversion() {
    if (this.decoder !== undefined) {
      this.decoder.free();
      this.decoder = undefined;
    }
  }

  appendDataWithConversion(data: Buffer): Buffer {
    if (this.decoder !== undefined) {
      // calling decoder to convert opus into wav.
      data = this.decoder.decodeFrame(data);
    }
    this.appendDataRaw(data);
    return data;
  }

  /** 向 buffer 添加数据，自动扩容 */
  appendDataRaw(data: Buffer): void {
    if (this.size !== BOSIZE_UNKNOWN && this.cursor >= this.size && data.length > 0) {
      // 有些时候 Stop 会比最后两帧数据来得更早，这种时候通常是音频数据，我选择放弃最后的结尾数据。
      console.warn(`Cannot append to a completed file, size: ${this.size}`);
      return;
    }

    const requiredSize = this.cursor + data.length;

    // 自动扩容逻辑（类似 std::vector）
    if (requiredSize > this.buf.length) {
      let newCapacity = Math.max(this.buf.length, 64); // 最小扩容为 64 字节
      while (newCapacity < requiredSize) {
        newCapacity *= 2;
      }

      const newBuf = Buffer.alloc(newCapacity);
      this.buf.copy(newBuf, 0, 0, this.cursor);
      this.buf = newBuf;
    }

    data.copy(this.buf, this.cursor);
    this.cursor += data.length;
  }

  /** 最后截断 buffer，并更新 size */
  stopAppending(): void {
    if (this.decoder !== undefined) {
      const wav = this.decoder.packWav(this.buf.subarray(0, this.cursor));
      this.cursor = 0;
      this.appendDataRaw(wav);
    }

    if (this.size !== BOSIZE_UNKNOWN && this.cursor > this.size) {
      console.error(
        `Cursor ${this.cursor} exceeds declared size ${this.size}, truncating`
      );
      this.cursor = this.size;
    }

    // 如果原来 size 是未知的，现在确认为 cursor
    if (this.size === BOSIZE_UNKNOWN) {
      this.size = this.cursor;
      console.log(`Size was unknown. Set to actual data length: ${this.size}`);
    }

    if (this.buf.length !== this.size) {
      this.buf = this.buf.subarray(0, this.size);
    }
  }

  /** 获取有效数据 */
  getData(): Buffer {
    // 如果 size 是未知的，返回当前 cursor 长度的数据
    if (this.size === BOSIZE_UNKNOWN) {
      return this.buf.subarray(0, this.cursor);
    } else {
      return this.buf.subarray(0, this.size);
    }
  }

  isComplete(): boolean {
    return this.size !== BOSIZE_UNKNOWN && this.cursor >= this.size;
  }

  saveToFile(dirPath: string, filename: string, onDone: (fullPath: string) => void) {
    const ext = BinaryObject.getExtension(this.type);
    const fullPath = path.join(dirPath, filename + ext);
    fs.writeFile(fullPath, this.getData(), (err) => {
      if (err) {
        console.error(`Failed to save file ${fullPath}:`, err);
        return;
      }
      onDone(fullPath);
    });
    return fullPath;
  }

  toJSON() {
    return {
      bosid: this.bosid.toString(),
      bosid_meaning: Snowflake.parseToReadable(this.bosid),
      type: BOTypeToString(this.type),
      size: this.size,
      cursor: this.cursor,
      // data: this.getData().toString('hex') // 或者其他格式
    };
  }

  async toOggBuffer(): Promise<Buffer> {
    if (this.type !== BOType.AudioOpus && this.type !== BOType.AudioWav) {
      throw new Error("Cannot convert to OGG buffer for non-audio types");
    }
    return convertWavToOpusOgg(this.getData());
  }

  toBinaryPackets(maxFramePayloadSize: number): BinaryPacket[] {
    if (this.size === BOSIZE_UNKNOWN) {
      throw new Error("Cannot create BinaryPackets from BinaryObject with unknown size");
    }
    const packets: BinaryPacket[] = [];
    let offset = 0;
    while (offset < this.size) {
      const frameSize = Math.min(maxFramePayloadSize, this.size - offset);
      const isLastFrame = (offset + frameSize >= this.size) ? 1 : 0;

      const header = new BinaryPacketHeader();
      header.bosid = this.bosid;
      header.size = this.size;
      header.offset = offset;
      header.frameSize = frameSize;
      header.isLastFrame = isLastFrame;
      header.type = this.type;
      // 创建数据部分
      const data = this.buf.subarray(offset, offset + frameSize);
      const packet = new BinaryPacket(header, data);
      packets.push(packet);

      offset += frameSize;
    }
    return packets;
  }

  private static getExtension(type: BOType): string {
    switch (type) {
      case BOType.RawText: return ".txt";
      case BOType.AudioOpus: return ".opus";
      case BOType.AudioOpusFrame: return ".opusframes";
      case BOType.AudioWav: return ".wav";
      case BOType.ImageJpeg: return ".jpg";
      default: return ".bin";
    }
  }
}

