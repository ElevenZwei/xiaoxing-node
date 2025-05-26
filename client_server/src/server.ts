import Fastify from 'fastify';
import { wsDemoPlugin } from './ws_demo';

const fastify = Fastify({ logger: true });
fastify.register(wsDemoPlugin, { prefix: '/ws' });
fastify.get('/', async () => {
  return { hello: 'world' };
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000 });
    console.log('Server listening on http://localhost:3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();