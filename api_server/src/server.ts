import express from 'express';
import http from 'http';
import userRoute from './route/userRoute';

const serverHost: string = process.env.API_HOST || '127.0.0.1';
const serverPort: number = Number(process.env.API_PORT) || 6810;

const app = express();
app.get('/', (_req, res) => {
  res.json({ hello: 'world' });
});

app.use('/user', userRoute);


const server = http.createServer(app);
server.listen(serverPort, serverHost, () => {
  console.log(`Server is running at http://${serverHost}:${serverPort}`);
});

