import Fastify from 'fastify';
import { wsDemoPlugin } from './ws_demo';
import { loginDemoPlugin } from './login_demo';

const fastify = Fastify({ logger: true });
fastify.register(import('@fastify/websocket'));
fastify.register(wsDemoPlugin, { prefix: '/ws' });
fastify.register(loginDemoPlugin, { prefix: '/login' });

fastify.get('/', async () => {
  return { hello: 'world' };
});

const localhost = true;
const host = localhost ? '127.0.0.1' : '0.0.0.0';
const port = 3000;
const start = async () => {
  try {
    await fastify.listen({ port, host });
    console.log(`Server listening on http://${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();