import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer, RawData } from 'ws';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
app.get('/', (req, res) => {
  res.send('WebSocket Echo Server is running');
});

wss.on('connection', handleEchoConnection);
server.listen(3000, () => {
  console.log('Server is listening on http://localhost:3000');
});

function handleEchoConnection(socket: WebSocket) {
    console.log('WebSocket connection established');
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
