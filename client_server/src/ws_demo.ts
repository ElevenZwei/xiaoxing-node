import { FastifyInstance } from 'fastify';
import { BinaryObject, BinaryPacket, BinaryPacketHeader } from './binary_packet';

async function wsPlugin(fastify: FastifyInstance, _opts: any) {
  fastify.register(import('@fastify/websocket'));
  fastify.get('/echo', { websocket: true }, (connection, _req) => {
    connection.socket.on('message', (message: string) => {
      console.log('Received message:', message);
      connection.socket.send(`Echo: ${message}`);
    });
    connection.socket.on('close', () => {
      console.log('WebSocket connection closed');
    });
  });
  fastify.route({
    method: 'GET',
    url: '/',
    wsHandler: (connection, _req) => {
      connection.socket.on('message', (message: string | Buffer, isBinary: boolean) => {
        // Handle incoming WebSocket messages
        if (isBinary) {
          wsBinaryHandler(connection.socket, message as Buffer);
        } else {
          wsMessageHandler(connection.socket, message as string);
        }
      });
      connection.socket.on('close', () => {
        console.log('WebSocket connection closed');
      });
      connection.socket.on('error', (error: Error) => {
        wsErrorHandler(connection.socket, error);
      });
    },
    handler: (_request, _reply) => {
      return { message: 'WebSocket endpoint is ready. Connect to /ws/echo' };
    },
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
    console.log('New BinaryObject started with bosid:', packet.header.bosid);
  }
  const obj = new BinaryObject(packet.header);
  obj.appendData(packet.data);
  context.bo_map.set(packet.header.bosid, obj);
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
      sample_rate: 16000,
      channels: 1,
      frame_duration: 60, // 60 ms
    },
  }
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
    // TODO: Here you can process the accumulated binary data
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
    console.log('Processing last BinaryObject:', last_obj.toJSON());
    // Here you can save the BinaryObject to a file or process it further
    last_obj.saveToFile('./data', `demo_${context.machine_id}_${last_bosid.toString()}`, (fullPath) => {
      console.log(`Saved BinaryObject to ${fullPath}`);
    });
    context.bo_map.delete(last_bosid);
    context.last_append_bosid = BigInt(0); // Reset last bosid
    // demo sentence
    sendSentence(socket, '这是一个测试句子。');
    return;
  }
}

/**
 * 发送给客户端句子
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


export {
    wsPlugin as wsDemoPlugin,
}