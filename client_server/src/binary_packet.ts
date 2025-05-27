// 这个文件定义了二进制数据包的结构和处理方法
// 包含头部信息和数据内容的类
// BinaryPacketHeader 用于解析和构建数据包头部
// BinaryPacket 用于解析和构建完整的数据包

import fs from 'fs';
import path from 'path';

// 定义 BOSIZE_UNKNOWN 常量，表示未知大小
const BOSIZE_UNKNOWN = 0xFFFFFFFF;

export enum BOType {
    RawText = 0x01,     // 原始文本
    AudioOpus = 0x10,   // 音频数据（Opus 编码）
    ImageJpeg = 0x20,   // 图像数据（JPEG 编码）
}

// 正向映射：Enum Value → String 名称
export function BOTypeToString(value: BOType): string {
  switch (value) {
    case BOType.RawText: return "RawText";
    case BOType.AudioOpus: return "AudioOpus";
    case BOType.ImageJpeg: return "ImageJpeg";
    default: return `Unknown(${value})`;
  }
}

// 反向映射：字符串名称 → Enum Value
export function BOTypeFromString(name: string): BOType | undefined {
  switch (name) {
    case "RawText": return BOType.RawText;
    case "AudioOpus": return BOType.AudioOpus;
    case "ImageJpeg": return BOType.ImageJpeg;
    default: return undefined;
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

export class BinaryObject {
  bosid: bigint;
  type: BOType;
  size: number;
  cursor: number;
  buf: Buffer;

  constructor(bosid: bigint, type: BOType, size: number) {
    this.bosid = bosid;
    this.type = type;
    this.size = size;
    this.cursor = 0;

    if (size !== BOSIZE_UNKNOWN) {
      this.buf = Buffer.alloc(size);
    } else {
      this.buf = Buffer.alloc(64); // 初始容量设为 64，按需扩容
    }
  }

  /** 向 buffer 添加数据，自动扩容 */
  appendData(data: Buffer): void {
    const requiredSize = this.cursor + data.length;

    // 自动扩容逻辑（类似 std::vector）
    if (requiredSize > this.buf.length) {
      let newCapacity = this.buf.length;
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
  }

  private static getExtension(type: BOType): string {
    switch (type) {
      case BOType.RawText: return ".txt";
      case BOType.AudioOpus: return ".opus";
      case BOType.ImageJpeg: return ".jpg";
      default: return ".bin";
    }
  }
}

