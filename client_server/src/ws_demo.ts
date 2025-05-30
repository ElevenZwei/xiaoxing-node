import { WebSocket, RawData, WebSocketServer } from 'ws';
import { BinaryObject, BinaryPacket, BOType, Snowflake } from './binary_packet';

export function wsEchoHandler(wss: WebSocketServer) {
  wss.on('connection', (socket: WebSocket) => {
    handleEchoConnection(socket);
  });
}

function handleEchoConnection(socket: WebSocket) {
  console.log('WebSocket echo connection established');
  if (!(socket instanceof WebSocket)) {
    console.error('Connection is not a WebSocket instance');
    return;
  }
  socket.on('message', (message: RawData, isBinary: boolean) => {
    if (isBinary) {
      // Handle binary messages if needed
      console.log('Received binary message:', message);
    } else {
      // Handle text messages
      console.log('Received message:', message);
      socket.send(`Echo: ${message}`);
    }
  });
  socket.on('close', () => {
    console.log('WebSocket connection closed');
  });
  socket.on('error', (error: Error) => {
    console.error('WebSocket error:', error);
  });
}

export function wsDemoHandler(wss: WebSocketServer) {
  wss.on('connection', (socket: WebSocket) => {
    handleDemoConnection(socket);
  });
}

function handleDemoConnection(socket: WebSocket) {
  console.log('WebSocket demo connection established');
  socket.on('message', (message: RawData, isBinary: boolean) => {
    if (isBinary) {
      wsBinaryHandler(socket, message as Buffer);
    } else {
      const msg = message.toLocaleString();
      wsMessageHandler(socket, msg);
    }
  });
  socket.on('close', () => {
    console.log('WebSocket connection closed');
  });
  socket.on('error', (error: Error) => {
    wsErrorHandler(socket, error);
  });
}

class DemoContext {
  machine_id: number;
  bo_map: Map<bigint, BinaryObject> = new Map();
  last_append_bosid: bigint = BigInt(0);
  constructor(machine_id: number) {
    this.machine_id = machine_id;
  }
};
const wsContextMap = new WeakMap<WebSocket, DemoContext>();

function wsMessageHandler(socket: WebSocket, message: string) {
  if (typeof message !== 'string') {
    console.error('Received non-string message:', message);
    return;
  }
  console.log('Received message:', message);
  const msg_json = JSON.parse(message);
  const type = msg_json.type;
  if (type == 'hello') {
    // client hello
    handleClientHello(socket, msg_json);
    return;
  } else if (type == 'listen') {
    // client listen mode change.
    handleClientListen(socket, msg_json);
    return;
  }
}

function wsBinaryHandler(socket: WebSocket, message: Buffer) {
  console.log('Received binary message:', message);
  // Here you can handle binary messages, e.g., audio data
  const context = wsContextMap.get(socket);
  if (!context) {
    console.error('No context found for this socket');
    return;
  }
  // Parse the binary message into a BinaryPacket
  const packet = BinaryPacket.fromBuffer(message);
  console.log('Parsed BinaryPacket Header:', packet.header.toJSON());
  // Store the packet in the context's map
  if (packet.header.bosid !== context.last_append_bosid) {
    context.last_append_bosid = packet.header.bosid;
  }
  let obj = context.bo_map.get(packet.header.bosid);
  if (!obj) {
    obj = new BinaryObject();
    obj.fromHeader(packet.header);
    context.bo_map.set(packet.header.bosid, obj);
    console.log('New BinaryObject started with bosid:', obj.bosid);
  }
  obj.appendData(packet.data);
  if (packet.header.isLastFrame) {
    obj.stopAppending();
    console.log('Received complete BinaryObject:', obj.toJSON());
  }
}

function wsErrorHandler(socket: WebSocket, error: Error) {
  console.error('WebSocket error:', error);
  // Handle WebSocket errors, e.g., log them or notify the client
  socket.close(1000, 'Error occurred');
}

function handleClientHello(socket: WebSocket, json: any) {
  console.log('Client says hello');
  // random machine_id for demo purposes
  const machine_id = Math.floor(Math.random() * 256); // Random machine ID between 0 and 255
  wsContextMap.set(socket, new DemoContext(machine_id));
  const response = {
    type: 'hello',
    transport: 'websocket',
    session_id: 'demo-session-id',
    machine_id: machine_id,
    use_binary_packet: true,
    audio_params: {
      format: 'opus',
      // 24kHz，表示服务器传给客户端的音频数据是 24kHz 的采样率
      // 这个数字最好和客户端的 AUDIO_OUTPUT_SAMPLE_RATE 一致。
      // 采样率是 24000Hz，单声道，帧长 60ms。
      // 60ms 的帧长，表示每个音频包的大小是 24000 * 0.06 = 1440 字节。
      sample_rate: 24000,
      channels: 1,
      frame_duration: 60, // 60 ms
    },
  }
  // log
  console.log('Sending hello response:', response);
  socket.send(JSON.stringify(response));
}

/**
 * 
 * @param socket WebSocket
 * @param json 
 * format:
 * {
 *  "type": "listen",
 *  "state": "start" | "stop" | "detect",
 *  "mode": "auto" | "manual" | "realtime",  (if state is "start")
 *  "text": <string>,  (if state is "detect")
 * }
 * @returns 
 */
function handleClientListen(socket: WebSocket, json: any) {
  console.log('Client listen mode change:', json);
  const context = wsContextMap.get(socket);
  if (!context) {
    console.error('No context found for this socket');
    return;
  }
  const state = json.state;
  if (state == 'start') {
    const mode = json.mode;;
    if (mode == 'manual') {
      console.log('Client is in manual listen mode');
    } else {
      console.error('Unsupported listen mode:', mode);
    }
    return;
  }
  if (state == 'stop') {
    console.log('Client stopped listening');
    // Here you can process the accumulated binary data
    const last_bosid = context.last_append_bosid;
    if (last_bosid === BigInt(0)) {
      console.error('No BinaryObject data to process');
      return;
    }
    const last_obj = context.bo_map.get(last_bosid);
    if (!last_obj) {
      console.error('No BinaryObject found for last bosid:', last_bosid);
      return;
    }
    last_obj.stopAppending();
    console.log('Processing last BinaryObject:', last_obj.toJSON());
    // filter size > 100MB
    if (last_obj.size > 100 * 1024 * 1024) { // 100MB
      console.error('BinaryObject size exceeds 100MB:', last_obj.size / 1024 / 1024, 'MB');
      return;
    }
    // Here you can save the BinaryObject to a file or process it further
    last_obj.saveToFile('./data', `demo_${context.machine_id}_${last_bosid.toString()}`, (fullPath) => {
      console.log(`Saved BinaryObject to ${fullPath}`);
    });
    // delete after half second.
    // 这是一个临时的解决方案，有时候有的数据包会在 stop 之后才到达。
    // 因为这是音频数据，所以我们假设最后的数据包可以忽略。
    // 真实场景里面可能需要一个统计，确定是不重要的音频数据再丢弃。
    setTimeout(() => {
      context.bo_map.delete(last_bosid);
      context.last_append_bosid = BigInt(0); // Reset last bosid
      console.log(`Deleted BinaryObject with bosid: ${last_bosid.toString()} from map`);
    }, 500);
    // demo sentence
    sendSentence(socket, '这是一个测试句子。');
    return;
  }
}

/**
 * 发送句子给客户端
 * @param socket WebSocket
 * @param sentence string
 * 发送给客户端句子的 JSON 格式如下
 * {
 *  "type": "tts",
 *  "state": "sentence_start",
 *  "text": <string>,
 *  }
 */
function sendSentence(socket: WebSocket, sentence: string) {
  const response = {
    type: 'tts',
    state: 'sentence_start',
    text: sentence,
  };
  socket.send(JSON.stringify(response));
}

const id_gen = new Snowflake(0x24);
function generateBOSID(): bigint {
  return id_gen.generate();
}

/**
 * 发送图片给客户端
 * @param socket WebSocket
 * @param imageData Buffer
 * 发送给客户端图片的 JSON 格式如下
 * { "type": "image", "bosid": <bigint> }
 * 其中 bosid 是一个唯一的 ID，用于标识这张图片。
 * 然后是许多个 BinaryPacket 数据包。
 * 数据包是 BinaryObject buffer 载入图片数据之后，切分出来的。
 */
function sendImage(socket: WebSocket, imageData: Buffer) {
  const bosid = generateBOSID();
  const response = {
    type: 'image',
    bosid: bosid.toString(),
  };
  socket.send(JSON.stringify(response));

  // Create a BinaryObject and append the image data
  const obj = new BinaryObject();
  obj.fromProps(bosid, BOType.ImageJpeg, imageData.length);
  obj.appendData(imageData);
  obj.stopAppending(); // Mark the object as complete
  console.log('Sending image with bosid:', bosid.toString(), ", size:", obj.size);
  // Send the BinaryObject as multiple BinaryPackets
  const packetSize = 1800; // Example packet size
  obj.toBinaryPackets(packetSize).forEach(packet => {
    const buffer = packet.toBuffer();
    console.log('Sending BinaryPacket with bosid:', packet.header.bosid.toString(), 
        ", offset:", packet.header.offset,
        ", frame_size:", packet.header.frameSize);
    socket.send(buffer);
  });
}
