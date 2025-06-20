/**
  * media.ts
  * This file defines functions for media encoding and decoding,
  * including audio and video processing.
  * 需要安装 ffmpeg 和 fluent-ffmpeg 库。
  */
import ffmpeg from 'fluent-ffmpeg';
import { PassThrough, Readable } from 'stream';
import { once } from 'events';

export type ResizeOptions = {
  scale: number;  // 缩放比例，例如 0.5 表示缩小一半
  method?: 'lanczos' | 'bilinear' | 'bicubic'; // 可选的缩放方法
}
export async function resizeJpeg(img: Buffer, opt: ResizeOptions): Promise<Buffer> {
  return resizeJpegFFmpeg(img, opt);
}
export async function resizeJpegFFmpeg(img: Buffer, opt: ResizeOptions): Promise<Buffer> {
  const { scale, method = 'lanczos' } = opt;
  if (scale <= 0 || scale > 10) {
    throw new Error(`Invalid scale value: ${scale}. Must be between 0 and 10.`);
  }
  const inputStream = new Readable();
  inputStream.push(img);
  inputStream.push(null);

  const outputStream = new PassThrough();
  const chunks: Buffer[] = [];
  outputStream.on('data', (chunk) => chunks.push(chunk));

  return new Promise<Buffer>(async (resolve, reject) => {
    ffmpeg(inputStream)
        .inputFormat('image2pipe')
        .outputFormat('image2')
        .videoCodec('mjpeg')
        .outputOptions([
          '-vf', `scale=iw*${scale}:${-1}:flags=${method}`,
        ])
        .on('error', (err) => {
          console.error('FFmpeg error:', err.message);
          reject(err);
        })
        .pipe(outputStream, { end: true });
    await once(outputStream, 'end');
    resolve(Buffer.concat(chunks));
  });
}


/**
  * 使用 ffmpeg 将 WAV Buffer 转换为 Opus 编码的 OGG Buffer
  * @param wavBuffer 原始 WAV 二进制数据
  * @returns Promise<Buffer> 转换后的 OGG 数据
  */
export async function convertWavToOpusOgg(wavBuffer: Buffer): Promise<Buffer> {
  const inputStream = new Readable();
  inputStream.push(wavBuffer);
  inputStream.push(null);

  const outputStream = new PassThrough();
  const chunks: Buffer[] = [];

  outputStream.on('data', (chunk) => chunks.push(chunk));

  return new Promise<Buffer>(async (resolve, reject) => {
    ffmpeg(inputStream)
        .inputFormat('wav')
        .audioCodec('libopus')
        .format('ogg')
        .on('error', (err) => {
          console.error('FFmpeg error:', err.message);
          reject(err);
        })
        .pipe(outputStream, { end: true });

    await once(outputStream, 'end');
    resolve(Buffer.concat(chunks));
  });
}

export type OggPageHeader = {
  version: number;
  headerType: number;
  granulePosition: bigint;
  serialNumber: number;
  sequenceNumber: number;
  checksum: number;
  pageSegments: number;
};

export type OggPage = {
  header: OggPageHeader;
  segmentSizes: number[];
  segmentData: Buffer;
  pageLength: number;
};

export class OggError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OggError";
  }
}
export class OggPageTooShortError extends OggError {
  constructor(message: string) {
    super(message);
    this.name = "OggPageTooShortError";
  }
}
export class OggPageInvalidError extends OggError {
  constructor(message: string) {
    super(message);
    this.name = "OggPageInvalidError";
  }
}

export function isOggPage(buffer: Buffer): boolean {
  const capturePattern = buffer.toString("utf-8", 0, 4);
  return capturePattern === "OggS";
}

export namespace OggPage {
  /**
    * 解析 Ogg 页面
    * @param buffer Ogg 页面数据的 Buffer
    * @return OggPage 解析后的 Ogg 页面对象
    * @throws {Error} 如果缓冲区不是有效的 Ogg 页面
    **/
  export function parse(buffer: Buffer): OggPage {
    if (!isOggPage(buffer)) throw new OggPageInvalidError("Invalid Ogg capture pattern");

    if (buffer.length < 27) throw new OggPageTooShortError("Not a valid Ogg page: too short");
    const version = buffer.readUInt8(4);
    const headerType = buffer.readUInt8(5);
    const granulePosition = buffer.readBigUInt64LE(6);
    const serialNumber = buffer.readUInt32LE(14);
    const sequenceNumber = buffer.readUInt32LE(18);
    const checksum = buffer.readUInt32LE(22);
    const pageSegments = buffer.readUInt8(26);

    if (buffer.length < 27 + pageSegments) {
      throw new OggPageTooShortError("Not a valid Ogg page: insufficient data for segments");
    }
    const segmentTable = buffer.subarray(27, 27 + pageSegments);
    const segmentSizes = Array.from(segmentTable);

    const totalSegmentDataLength = segmentSizes.reduce((sum, size) => sum + size, 0);
    const segmentDataStart = 27 + pageSegments;
    const pageLength = segmentDataStart + totalSegmentDataLength;
    if (buffer.length < pageLength) {
      throw new OggPageTooShortError("Not a valid Ogg page: insufficient data for segment data");
    }
    const segmentData = buffer.subarray(segmentDataStart, segmentDataStart + totalSegmentDataLength);
    const header: OggPageHeader = {
      version,
      headerType,
      granulePosition,
      serialNumber,
      sequenceNumber,
      checksum,
      pageSegments,
    };

    return {
      header,
      segmentSizes,
      segmentData,
      pageLength,
    };
  }
}

export class OggStreamReader {
  private pageHook: OggStreamReader.PageHook | undefined;
  private packetHook: OggStreamReader.PacketHook | undefined;
  private packetSegments: Map<Number, Buffer[]> = new Map();
  private leftoverData: Buffer | null = null;

  setOnPageHook(hook: OggStreamReader.PageHook): void {
    this.pageHook = hook;
  }
  setOnPacketHook(hook: OggStreamReader.PacketHook): void {
    this.packetHook = hook;
  }

  readPages(data: Buffer): number {
    let offset = 0;
    try {
      while (offset < data.length) {
        offset += this.readOnePage(data.subarray(offset));
      }
    } catch (err) {
      if (err instanceof OggPageTooShortError) {
        // If we encounter a short page, we save the leftover data for next read.
        this.leftoverData = data.subarray(offset);
      } else { throw err; }
    }
    return offset;
  }

  readData(data: Buffer): void {
    if (this.leftoverData) {
      // If we have leftover data, prepend it to the new data.
      data = Buffer.concat([this.leftoverData, data]);
      this.leftoverData = null;
    }
    this.readPages(data);
  }

  // return length of this page.
  private readOnePage(data: Buffer): number {
    const page = OggPage.parse(data);
    if (this.pageHook) {
      this.pageHook(page);
    }
    // packet across pages must has header type & 0x1 set.
    if ((page.header.headerType & 0x1) === 0) {
      this.triggerPacketHook(page.header);
    }
    if (!this.packetSegments.has(page.header.serialNumber)) {
      this.packetSegments.set(page.header.serialNumber, []);
    }
    const segments = this.packetSegments.get(page.header.serialNumber)!;
    // Process segments in the current page
    let segmentOffset = 0;
    for (let i = 0; i < page.segmentSizes.length; i++) {
      const segmentSize = page.segmentSizes[i];
      if (segmentSize > 0) {
        const seg = page.segmentData.subarray(segmentOffset, segmentOffset + segmentSize);
        segments.push(seg);
        segmentOffset += segmentSize;
      }
      // 0xff indicates a continuation of the packet across segments.
      if (segmentSize < 0xff) {
        // packet end detected
        this.triggerPacketHook(page.header);
      }
    }
    return page.pageLength;
  }

  private triggerPacketHook(header: OggPageHeader): void {
    const segs = this.packetSegments.get(header.serialNumber) ?? [];
    if (segs.length > 0 && this.packetHook) {
      const packetData = Buffer.concat(segs);
      this.packetHook(packetData, header);
      this.packetSegments.set(header.serialNumber, []);
    }
  }
};

export type OggPacket = Buffer;
export namespace OggStreamReader {
  // PageHook 在收到 Ogg Page 时调用。
  export type PageHook = (page: OggPage) => void;
  // PacketHook 在收到 Ogg Packet 时调用。
  export type PacketHook = (packet: OggPacket, header: OggPageHeader) => void;
}

export class OggPacketInvalidError extends OggError {
  constructor(message: string) {
    super(message);
    this.name = "OggPacketInvalidError";
  }
}

export namespace OggPacket {
  // OggPacket.Type 定义了 Ogg Packet 的类型。
  export enum Type { Head, Tags, Audio, }
  // OggPacket.AudioMetadata 定义了 Ogg 音频包的元数据。
  export type AudioMetadata = {
    frameSize: number;
    frameCount: 1 | 2 | undefined;
    channels: 1 | 2;
  }

  export function parseAudioMetadata(packet: Buffer): AudioMetadata | null {
    const toc = packet[0];
    if (toc === 0x4f) { // character 'O'
      return null; // Not an audio packet
    }
    const config = toc >> 3;
    const channels = ((config >> 2) & 0b1) + 1; // 0: mono, 1: stereo
    const code = toc & 0b11;
    if (code > 3) {
      throw new OggPacketInvalidError(`Unknown Ogg audio packet code: ${code}`);
    }
    const res = {
      frameSize: 0,
      frameCount: [1, 2, 2, undefined][code] as 1 | 2 | undefined,
      channels: channels as 1 | 2,
    };
    if (config < 12) {
      const arr = [10, 20, 40, 60];
      res.frameSize = arr[config & 0b11];
    } else if (config < 16) {
      const arr = [10, 20];
      res.frameSize = arr[config & 0b1];
    } else {
      const arr = [2.5, 5, 10, 20];
      res.frameSize = arr[config & 0b11];
    }
    return res;
  }

  export function parseType(packet: Buffer): Type {
    if (packet.length === 0) {
      throw new OggPacketInvalidError("Packet must not be empty");
    }
    const toc = packet[0];
    if (toc !== 0x4f) // character 'O'
      return Type.Audio;
    if (packet.length < 8)
      throw new OggPacketInvalidError("Packet too short to determine type");
    const name = packet.toString("ascii", 0, 8);
    if (name === "OpusHead")
      return Type.Head;
    if (name === "OpusTags")
      return Type.Tags;
    throw new OggPacketInvalidError(`Unknown Ogg packet type: ${name}`);
  }

  // mergePackets 将多个 OggPacket 合并为一个。
  export function mergePackets(packets: OggPacket[]): Buffer {
    if (packets.length === 0) return Buffer.alloc(0);
    if (packets.length === 1) return packets[0];

    // check if all packets are of the same type
    const tocBytes = packets.map(p => p[0]);
    const sameType = tocBytes.every(b => b === tocBytes[0]);
    if (!sameType)
      throw new OggPacketInvalidError("Cannot merge packets of different types");
    const frameCountBits = tocBytes[0] & 0b11;
    if (frameCountBits > 0)
      throw new OggPacketInvalidError("Cannot merge packets with multiple frames");

    const frames = packets.map(p => p.subarray(1));
    const frameLengthArr = frames.map(f => f.length);
    const numFrames = frameLengthArr.length;

    if (numFrames > 48) {
      throw new OggPacketInvalidError("Cannot merge more than 48 packets");
    }

    const frameLenBytesArr: Uint8Array[] = [];
    for (let i = 0; i < numFrames - 1; i++) {
      frameLenBytesArr.push(encodeFrameLen(frameLengthArr[i]));
    }
    const frameLenBytes = Buffer.concat(frameLenBytesArr);
    const totalLength = 1 + (numFrames > 2 ? 1 : 0)
        + frameLenBytes.length + frameLengthArr.reduce((sum, size) => sum + size, 0);
    const output = Buffer.alloc(totalLength);
    let offset = 0;
    const newTocByte = (tocBytes[0] & 0b11111100) | (numFrames > 2 ? 0b11 : 0b10); // set new frame count bits
    output.writeUInt8(newTocByte, offset++); // write TOC byte
    if (numFrames > 2) {
      // VBR=1 (bit 7), padding=0 (bit 6), rest of bits are frame count
      output.writeUInt8(0x80 | numFrames, offset++); // write frame count byte
    }
    // write frame length bytes
    output.set(frameLenBytes, offset);
    offset += frameLenBytes.length;
    // write all frames
    frames.forEach(frame => {
      output.set(frame, offset);
      offset += frame.length;
    });
    return output;
  }

  // encodeFrameLen 将帧长度编码为 Ogg Packet 的长度格式。
  function encodeFrameLen(len: number): Uint8Array {
    if (len < 252) {
      return new Uint8Array([len]);
    }
    if (len > 1275) {
      throw new RangeError("Frame length too large");
    }
    // 1275 - 252 = 1023, ensures that b2 is always less than 256.
    const b2 = (len - 252) >> 2;
    const b1 = len - (b2 << 2);
    return new Uint8Array([b1, b2]);
  }

}


