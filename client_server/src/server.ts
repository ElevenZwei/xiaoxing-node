import fs from 'fs';
import path from 'path';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { wsDemoHandler } from './ws_demo';
import { loginDemoRouter } from './login_demo';

const app = express();
const server = http.createServer(app);

// 普通 HTTP 路由
app.get('/', (_req, res) => {
  res.json({ hello: 'world' });
});

// 设置路由
app.use('/login', loginDemoRouter); // 替代 fastify.register(loginDemoPlugin, { prefix: '/login' })
// app.use('/ws', wsDemoRouter);       // 提供 WebSocket 路由描述（可选）

// WebSocket 路由
const wss = new WebSocketServer({server, path: '/ws'});
wsDemoHandler(wss);

// 创建数据文件夹
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`Data directory created at ${dataDir}`);
} else {
  console.log(`Data directory already exists at ${dataDir}`);
}

// 启动监听
const localhost = true;
const host = localhost ? '127.0.0.1' : '0.0.0.0';
const port = 3000;

server.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});
