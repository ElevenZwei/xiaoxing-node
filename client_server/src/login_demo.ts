import { Router } from 'express';

/**
 * 这个 login 是一个硬件报告自己编号和版本号的接口。
 * 设备会发送一个 POST 请求。
 * 服务器回复一个 JSON 对象，包含服务器地址等等信息。
 * 类似于登陆网关的作用。
 * 设备会在收到这个 JSON 对象后，开始向服务器发送数据。
 * 
 * 小智 AI 原版的 login + activate 太复杂了。我可以做个简化。
 * 
 * 设备发送的 POST 请求需要 JSON 内容。
 * {
 *  "version": 3,
 *  "hardware": {
 *   "board": "xiaoxing",
 *   "chip": "esp32s3",
 *   "mac": "00:11:22:33:44:55",
 *   "serial": "1234567890",
 *   "flash_size": 4194304,
 *   "psram_size": 8388608,
 *  },
 *  "software": {
 *   "name": "xiaoxing",
 *   "version": "1.0.0",
 *   "idf_version": "4.4.2",
 *   "compile_time": "2023-10-01T12:00:00Z",
 *   "elf_sha256": <string>,
 *  }
 * }
 * 
 * 服务器回复的 JSON 会根据这个设备是否之前注册过有所不同，
 * 在 demo 里面我们全都当作注册过的简单回复。
 * {
 *  "websocket": {
 *   "url": "ws://example.com/ws",
 *   "token": <string>,
 *  },
 *  "server_time": {
 *   "timestamp": 1700000000,
 *   "timezone_offset": 28800
 *  },
 * }
 */

export const loginDemoRouter = Router();

function getPosixTimeZoneString() {
  const offsetMinutes = new Date().getTimezoneOffset();  // 单位是分钟，UTC-本地
  const offsetHours = -offsetMinutes / 60;  // 本地-UTC（正值表示东区）
  let tzName = "UTC"; // 可自定义名字，比如 "CST, UTC"
  return `${tzName}${offsetHours >= 0 ? '-' : '+'}${Math.abs(offsetHours)}`;
}

loginDemoRouter.post('/', (request, reply) => {
  // const body = request.body as any;
  // skip body validation for demo purposes
  // just reply with a fixed JSON object
  const host = request.headers.host || 'localhost';
  // parse port from host if available
  const portMatch = host.match(/:(\d+)$/);
  const port = portMatch ? portMatch[1] : '80'; // default to 80 if no port is specified
  const response = {
    websocket: {
      url: `ws://${request.hostname}:${port}/ws`,
      token: "demo-token",
    },
    server_time: {
      timestamp: Date.now(),  // current timestamp in milliseconds
      timezone_posix: getPosixTimeZoneString(), // e.g., "CST-8"
    },
  };
  // log
  console.log('Login request received, replying with:', response);
  reply.json(response);
});