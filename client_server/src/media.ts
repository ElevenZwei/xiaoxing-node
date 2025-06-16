/**
  * media.ts
  * This file defines functions for media encoding and decoding,
  * including audio and video processing.
  */
import ffmpeg from 'fluent-ffmpeg';
import { PassThrough, Readable } from 'stream';
import { once } from 'events';

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

  ffmpeg(inputStream)
      .inputFormat('wav')
      .audioCodec('libopus')
      .format('ogg')
      .on('error', (err) => {
        console.error('FFmpeg error:', err.message);
      })
      .pipe(outputStream, { end: true });

  await once(outputStream, 'end');
  return Buffer.concat(chunks);
}

export type OggPage = {
  version: number;
  headerType: number;
  granulePosition: bigint;
  serialNumber: number;
  sequenceNumber: number;
  checksum: number;
  pageSegments: number;
  segmentSizes: number[];
  segmentData: Buffer;
};

/**
  * 解析 Ogg 页面
  * @param buffer Ogg 页面数据的 Buffer
  * @return OggPage 解析后的 Ogg 页面对象
  * @throws {Error} 如果缓冲区不是有效的 Ogg 页面
  **/
export function parseOggPage(buffer: Buffer): OggPage {
  if (buffer.length < 27) throw new Error("Not a valid Ogg page: too short");

  const capturePattern = buffer.toString("utf-8", 0, 4);
  if (capturePattern !== "OggS") throw new Error("Invalid Ogg capture pattern");

  const version = buffer.readUInt8(4);
  const headerType = buffer.readUInt8(5);
  const granulePosition = buffer.readBigUInt64LE(6);
  const serialNumber = buffer.readUInt32LE(14);
  const sequenceNumber = buffer.readUInt32LE(18);
  const checksum = buffer.readUInt32LE(22);
  const pageSegments = buffer.readUInt8(26);

  const segmentTable = buffer.subarray(27, 27 + pageSegments);
  const segmentSizes = Array.from(segmentTable);

  const totalSegmentDataLength = segmentSizes.reduce((sum, size) => sum + size, 0);
  const segmentDataStart = 27 + pageSegments;
  const segmentData = buffer.subarray(segmentDataStart, segmentDataStart + totalSegmentDataLength);

  return {
    version,
    headerType,
    granulePosition,
    serialNumber,
    sequenceNumber,
    checksum,
    pageSegments,
    segmentSizes,
    segmentData
  };
}

