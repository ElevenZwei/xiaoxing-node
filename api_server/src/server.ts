import express from 'express';
import http from 'http';
import userRoute from './route/userRoute';
import chatRoute from './route/chatRoute';
import messageRoute from './route/messageRoute';

const serverHost: string = process.env.API_HOST || '127.0.0.1';
const serverPort: number = Number(process.env.API_PORT) || 6810;

const app = express();

// Middleware to parse JSON request bodies
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ hello: 'world' });
});

app.use('/user', userRoute);
app.use('/chat', chatRoute);
app.use('/message', messageRoute);


const server = http.createServer(app);
server.listen(serverPort, serverHost, () => {
  console.log(`Server is running at http://${serverHost}:${serverPort}`);
});

