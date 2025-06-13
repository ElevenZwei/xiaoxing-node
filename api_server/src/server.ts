import express from 'express';
import http from 'http';
import { jsonBigIntMiddleware } from './json_bigint';

import userRoute from './route/userRoute';
import chatRoute from './route/chatRoute';
import messageRoute from './route/messageRoute';
import binaryRoute from './route/binaryRoute';

const serverHost: string = process.env.API_HOST || '127.0.0.1';
const serverPort: number = Number(process.env.API_PORT) || 6810;

const app = express();

// Middleware to parse JSON request bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Middleware to handle BigInt in JSON responses
app.use(jsonBigIntMiddleware);

app.get('/', (_req, res) => {
  res.json({ hello: 'world' });
});

app.use('/user', userRoute);
app.use('/chat', chatRoute);
app.use('/message', messageRoute);
app.use('/binary', binaryRoute);

const server = http.createServer(app);
server.listen(serverPort, serverHost, () => {
  console.log(`Server is running at http://${serverHost}:${serverPort}`);
});

