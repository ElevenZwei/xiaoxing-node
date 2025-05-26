import { FastifyInstance } from "fastify";

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
 * 
 */


async function loginPlugin(fastify: FastifyInstance, opts: any) {
    fastify.post('/', async (request, reply) => {
    });
}

export {
    loginPlugin as loginDemoPlugin,
};