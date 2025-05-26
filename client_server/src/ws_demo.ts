import { FastifyInstance } from 'fastify';

async function wsPlugin(fastify: FastifyInstance, opts: any) {
  fastify.register(import('@fastify/websocket'));
  fastify.get('/', (_request, reply) => {
    reply.send({ message: 'WebSocket endpoint' });
  });
  fastify.get('/echo', { websocket: true }, (connection, _req) => {
    connection.socket.on('message', (message: string) => {
      console.log('Received message:', message);
      connection.socket.send(`Echo: ${message}`);
    });
    connection.socket.on('close', () => {
      console.log('WebSocket connection closed');
    });
  });
  
}

export {
    wsPlugin as wsDemoPlugin,
}