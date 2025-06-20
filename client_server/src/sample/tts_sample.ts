// import { TTSVolcano, TTSDeltaHook } from './tts_helper';
import { TTSStreamVolcano, } from '../tts_stream_helper';
import { OggPacket, OggPageHeader, OggStreamReader, } from '../media';
import * as readline from 'readline';
import fs from 'fs';
import path from 'path';
import { BinaryObject, BOType, BOSIZE_UNKNOWN } from '../binary_packet';
import { Mutex } from 'async-mutex'

const tts = new TTSStreamVolcano();
tts.setSpeaker('multi_female_shuangkuaisisi_moon_bigtts');
tts.setOnDeltaHook(ttsDelta);

const oggReader = new OggStreamReader();
oggReader.setOnPageHook((page) => {
  console.log(`Received Ogg page with serial: ${page.header.serialNumber}, sequence: ${page.header.sequenceNumber}, length: ${page.pageLength}`);
});

const oggPacketCache: Buffer[] = [];
const mutex = new Mutex();
oggReader.setOnPacketHook((packet: Buffer, _header: OggPageHeader) => {
  const meta = OggPacket.parseAudioMetadata(packet);
  if (!meta) {
    console.log(`Received Ogg non-audio packet, length: ${packet.length}`);
    return;
  }
  console.log(`Received Ogg packet with metadata: ${JSON.stringify(meta)}, toc=${packet[0].toString(16)}, length=${packet.length}`);
  // Here you can process the audio packet, e.g., save it to a file or play it
  if (meta.frameSize !== 20) {
    console.warn(`Unexpected frame size: ${meta.frameSize}, expected 20`);
    return;
  }
  // pushMergedPacketToBinaryObject(packet).catch(console.error);
  oggPacketCache.push(packet);
  if (oggPacketCache.length < 3) {
    return;
  }
  const merged: Buffer = OggPacket.mergePackets(oggPacketCache);
  oggPacketCache.length = 0; // Clear the cache
  console.log(`Merged Ogg packets into one buffer of size: ${merged.length}`);
  pushMergedPacketToBinaryObject(merged).catch(console.error);
});

let bo: BinaryObject | null = null;
async function pushMergedPacketToBinaryObject(data: Buffer) {
  mutex.runExclusive(async () => {
    if (bo === null) {
      bo = new BinaryObject();
      bo.fromProps(1n, BOType.AudioOpusFrame, BOSIZE_UNKNOWN);
      await bo.enableAudioConversion(48000, 1);
    }
    console.log(`Appending ${data.length} bytes to BinaryObject.`);
    await bo.appendDataWithConversion(data);
    console.log(`Appended ${data.length} bytes to BinaryObject, total size: ${bo.getData().length} bytes.`);
  });
}
async function flushBinaryObject() {
  if (bo === null) {
    return;
  }
  console.log(`Flushing BinaryObject with ${bo.getData().length} bytes of data.`);
  await bo.stopAppending();
  bo.saveToFile(path.join(__dirname, '../../data/tts'), 'output', (fpath) => {
    console.log(`BinaryObject saved to ${fpath}`);
  });
  bo = null; // Reset the BinaryObject
}


function ttsDelta(data: Buffer | null) {
  console.log(`Received TTS delta data: ${data ? data.length : 'null'}`);
  if (data === null) {
    console.log("TTS session ended, flushing remaining data.");
    flushBinaryObject().catch(console.error);
    return;
  }
  oggReader.readData(data);
}


const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> ',
});

rl.on('line', async (input: string) => {
  if (input.length === 0) {
    console.log("请输入想要语音合成的话。");
    rl.prompt();
    return;
  }
  await tts.beginSession();
  await tts.addText(input);
  await tts.endSession();
  const output = await tts.waitFinish();
  // save output to a file with name '../data/tts/input.ogg';
  const filename = input.replace(/[/%@$#\[\]{}. ]/g, '_').substring(0, 20) || 'default';
  const outputPath = path.join(__dirname, `../data/tts/${filename}.ogg`);
  // mkdir if not exists
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output);
  console.log(`TTS output saved to ${outputPath}`);
  rl.prompt();
});

rl.prompt();

