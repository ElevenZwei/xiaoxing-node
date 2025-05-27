import { FastifyInstance } from 'fastify';
import { BinaryPacket, BinaryPacketHeader } from './binary_packet';

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
  bo_map: Map<bigint, BinaryPacket> = new Map();
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
  // For demo purposes, we just echo it back
  // socket.send(message);
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
    return;
  }
}

export {
    wsPlugin as wsDemoPlugin,
}