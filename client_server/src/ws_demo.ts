import { WebSocket, RawData, WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import sanitize from 'sanitize-filename';
import sharp from 'sharp';
import Denque from 'denque';
import { Mutex } from 'async-mutex';

import axios from 'axios';
import { FormData, Blob } from 'formdata-node';
import { FormDataEncoder } from 'form-data-encoder';
import { Readable } from 'stream';

import { BinaryObject, BinaryPacket, BOType, Snowflake } from './binary_packet';
import { LLMRole, LLMHelper, LLMProvider,  LLMMsg, ChunkCollector, } from './llm_helper';
import { TTIToolWrapper,
  OpenImageTool,
  Generate3DModelTool,
  Render3DModelTool,
} from './llm_tool';

import * as Api from './api_query';
import { TTSSentence, TTSStreamVolcano, TTSStreamQueue } from './tts_stream_helper';
import { OggPageHeader, OggStreamReader, OggPacket } from './media';
import { catchToString } from './string';

const id_gen = new Snowflake(0x24);
function generateSID(): bigint {
  return id_gen.generate();
}
const ASR_URL = 'http://localhost:8000/recognize'; // Example ASR service URL

enum SenderType {
  User = 0x4001,
  AI = 0x4002,
  Tool = 0x4003,
  System = 0x4004,
  Hidden = 0x4020,
};
function llmMsgToSenderType(role: string): SenderType {
  switch (role) {
    case LLMRole.User:
      return SenderType.User;
    case LLMRole.AI:
      return SenderType.AI;
    case LLMRole.Tool:
      return SenderType.Tool;
    case LLMRole.System:
      return SenderType.System;
    default:
      console.warn(`Unknown role: ${role}, defaulting to hidden`);
      return SenderType.Hidden;
  }
}

export function wsDemoHandler(wss: WebSocketServer) {
  wss.on('connection', (socket: WebSocket) => {
    handleDemoConnection(socket);
  });
}

function handleDemoConnection(socket: WebSocket) {
  console.log('WebSocket demo connection established');
  socket.on('message', async (message: RawData, isBinary: boolean) => {
    try {
      if (isBinary) {
        wsBinaryHandler(socket, message as Buffer);
      } else {
        const msg = message.toLocaleString();
        wsTextHandler(socket, msg);
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      wsErrorHandler(socket, error as Error);
    }
  });
  socket.on('close', () => {
    console.log('WebSocket connection closed');
    wsContextMap.delete(socket);
  });
  socket.on('error', (error: Error) => {
    wsErrorHandler(socket, error);
  });
}

type FocusChat = {
  chatId: bigint;
  chatName: string;
  lastMessageIndex: number;
};
type ObjectContext = {
  bo: BinaryObject;
  mutex: Mutex;
};

class DemoContext {
  clientId: bigint;
  pingTimer: NodeJS.Timeout | null = null;
  userId: bigint = BigInt(0); // demo user id is 0
  chat: FocusChat | null = null;

  boMap: Map<bigint, ObjectContext> = new Map();
  lastAppendBosid: bigint = BigInt(0);

  clientSampleRate: number = 16000;
  clientChannels: number = 1;

  llmHelper: LLMHelper;
  llmReply: AIReply = { messageId: null, };
  llmMutex: Mutex = new Mutex();
  ttsSessions: LLMTTS[] = [];

  constructor(clientId: bigint, helper: LLMHelper) {
    this.clientId = clientId;
    this.llmHelper = helper;
  }
  // 清理过期的 TTS 会话。
  clearOutdatedTTS() {
    const res = [];
    for (const tts of this.ttsSessions) {
      if (tts.isEmpty() === false) {
        // 如果 TTS 会话已经结束，清理掉。
        res.push(tts);
      }
    }
    this.ttsSessions = res;
  }
  // 停止 TTS 音频推送。
  stopTTSAudioPush() {
    for (const tts of this.ttsSessions) {
      tts.setAudioPush(false);
    }
  }
};
const wsContextMap = new WeakMap<WebSocket, DemoContext>();

function wsTextHandler(socket: WebSocket, message: string) {
  if (typeof message !== 'string') {
    console.error('Received non-string message:', message);
    return;
  }
  console.log('Received message:', message);
  const msg_json = JSON.parse(message);
  const type = msg_json.type;
  try {
    if (type === 'hello') {
      // client hello
      handleClientHello(socket, msg_json);
    } else if (type === 'chat') {
      handleClientChat(socket, msg_json);
    } else if (type === 'listen') {
      // client listen mode change.
      handleClientListen(socket, msg_json);
    } else if (type === 'binary') {
      // client wants to query binary packets
      handleClientBinary(socket, msg_json);
    } else if (type === 'abort') {
    handleClientAbort(socket, msg_json);
    } else {
      console.warn('Unknown message type:', type);
    }
  } catch (error) {
    // 如果在最外层捕获错误，那么表明这是一个需要关闭连接的错误。
    console.error('Error handling WebSocket message:', error);
    wsErrorHandler(socket, error as Error);
  }
}

function wsBinaryHandler(socket: WebSocket, message: Buffer) {
  // console.log('Received binary message:', message);
  // Here you can handle binary messages, e.g., audio data
  const context = wsContextMap.get(socket);
  if (!context) {
    console.error('wsBinaryHandler: No context found for this socket');
    return;
  }
  // Parse the binary message into a BinaryPacket
  const packet = BinaryPacket.fromBuffer(message);
  // console.log('Parsed BinaryPacket Header:', packet.header.toJSON());
  console.log('Parsed BinaryPacket type:', packet.header.type);
  // Store the packet in the context's map
  if (packet.header.bosid !== context.lastAppendBosid) {
    context.lastAppendBosid = packet.header.bosid;
  }

  let objctx = context.boMap.get(packet.header.bosid);
  if (!objctx) {
    const obj = new BinaryObject();
    obj.fromHeader(packet.header);
    objctx = { bo: obj, mutex: new Mutex() };
    context.boMap.set(packet.header.bosid, objctx);
    console.log('New BinaryObject started with bosid:', obj.bosid);
  }

  objctx.mutex.runExclusive(async () => {
    const obj = objctx.bo;
    // 所有 await 都会打乱函数开始和结束的顺序。
    // 这里的 await 迫使我们在外层还要再加一层 Mutex ，确保 BinaryHandler 保持收到的数据顺序。
    // 不然第一个回调卡在这个 await 的时候，第二个回调会更早插入 appendData 的队列，
    // 然后第一个回调的数据反而在后面。
    await obj.enableAudioConversion(context.clientSampleRate, context.clientChannels);
    await obj.appendDataWithConversion(packet.data);
    // TODO: check object size and handle large objects
    if (packet.header.isLastFrame) {
      await obj.stopAppending();
      console.log('Received complete BinaryObject:', objctx.bo.toJSON());
    }
  });
}

function wsErrorHandler(socket: WebSocket, error: Error) {
  console.error('WebSocket error:', error);
  // Handle WebSocket errors, e.g., log them or notify the client
  socket.close(1000, 'Error occurred');
}

function createNewContext(socket: WebSocket, clientId: bigint): DemoContext {
  const systemPrompt = 
    `你是一个活泼友好的年轻女孩，你现在在和用户聊天，你很乐于帮助他解决问题，你需要保持日常聊天的对话风格来回应。你所说的话会经过语音合成传递给用户，所以请不要输出难以朗读的部分，也不要使用表情符号。你应该使用日常对话的方式代替括号等书面表达。重复一下，你不能使用 markdown 语法记号，或者任何的非口语表达，你必须输出可以念出来的内容。`;
  const ttiWrap = new TTIToolWrapper();
  const openImageTool = new OpenImageTool();
  const generate3dModelTool = new Generate3DModelTool();
  const render3dModelTool = new Render3DModelTool();

  render3dModelTool.spinUp().then(() => {
    console.log('Render3DModelTool is ready');
  }).catch((err) => {
    console.error('Failed to spin up Render3DModelTool:', err);
  });

  const helper = new LLMHelper(
      LLMProvider.OpenRouter, 'anthropic/claude-3.5-haiku',
      30, systemPrompt, [
        ttiWrap.tool,
        openImageTool.tool,
        generate3dModelTool.tool,
        render3dModelTool.tool,
      ]);

  const context = new DemoContext(clientId, helper);
  wsContextMap.set(socket, context);
  context.pingTimer = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.ping();
      // send json 可以刷新客户端那边的连接计时器
      const pingMessage = JSON.stringify({ type: 'ping', client_id: context.clientId.toString() });
      socket.send(pingMessage);
      console.log('Sent ping message:', pingMessage);
    } else {
      // clear the ping timer if the socket is closed
      console.warn('WebSocket is not open, cannot send ping');
      clearInterval(context.pingTimer!);
      context.pingTimer = null;
    }
  }, 30000); // 30 seconds ping interval

  ttiWrap.setHook(async (input, imageOutput) => {
    const bosid = generateSID();
    const filename = bosid.toString() + '_' + sanitize(input.name || 'image') + '.jpg';
    if (imageOutput.success === false) {
      throw new Error(`创建图片失败，不应该调用 OutputHook : ${imageOutput.error}`);
    }
    const data = imageOutput.image;
    try {
      if (context.chat === null || context.chat.chatId === BigInt(0)) {
        const output: TTIToolWrapper.Output = {
          success: false,
          error: '请先打开一个聊天会话，再创建图片。',
        };
        return output;
      }
      // 上传图片到服务器，图片和这条媒体消息的 bosid 是一样的。
      await uploadMediaMessage({
        msgId: bosid,
        chatId: context.chat.chatId,
        mediaType: BOType.ImageJpeg,
        mediaObjectId: bosid,
        socket,
        hasMediaData: true,
        saveName: filename,
        mediaName: input.name || `Image ${bosid.toString()}`,
        description: input.prompt || 'Generated Image',
        mediaData: data, // 直接上传数据
      });
      clientPushImageMessage(socket, bosid);
      const output: TTIToolWrapper.Output = {
        success: true,
        text: `图片已经创建并显示在聊天界面中，如果有工具需要引用这张图片作为输入，你可以用这个数字 ${bosid.toString()} 来引用它。`,
        imageId: bosid,
      };
      return output;
    } catch (err) {
      console.error('Failed to save image:', err);
      const output: TTIToolWrapper.Output = {
        success: false,
        error: '图片保存失败，请稍后再试。',
      };
      return output;
    }
  });

  openImageTool.setHook(async (input): Promise<OpenImageTool.Output> => {
    const bosid = BigInt(input.imageId);
    if (input.showInChat) {
      // 这个消息推送是一个临时性保证 AI 调用工具顺序和客户端看到的图片顺序一致的方案。
      // 因为 Api 返回的顺序和发起请求的顺序不一定一致。
      // TODO: 这种实际上应该使用一个消息队列来处理。
      clientPushImageMessage(socket, bosid);
    }
    const info = await Api.fetchBinaryObjectInfo(bosid);
    if (info.success === false) {
      console.error(`无法获取图片信息，bosid: ${bosid.toString()}, error: ${info.error}`);
      return { success: false, error: `获取图片信息出错了。` };
    }
    // 有时候 AI 会传入一个不是图片的 bosid，这个时候我们需要检查一下。
    if (info.file_type !== BOType.ImageJpeg) {
      console.error(`获取的文件类型不正确，bosid: ${bosid.toString()}, type: ${info.file_type}`);
      return { success: false, error: `获取的文件类型不正确，输入的应该是一个对应图片的数字 id ，而不是其他类型的文件，请检查。` };
    }
    if (input.showInChat) {
      // TODO: Api 返回的顺序和发起请求的顺序不一定一致。
      await uploadMediaMessage({
        msgId: generateSID(),
        chatId: context.chat?.chatId ?? BigInt(0),
        mediaType: BOType.ImageJpeg,
        mediaObjectId: bosid,
        socket,
        hasMediaData: false,
        mediaName: info.name || `Image ${bosid.toString()}`,
      });
    }
    const response: OpenImageTool.Output = {
      success: true,
      imageId: bosid,
      imageDescription: info.description ?? '暂无图片描述',
    };
    return response;
  });

  generate3dModelTool.setInputHook(async (input) => {
    const dl = await Api.fetchBinaryObjectInfoData(input.imageId);
    if (!dl.success) {
      console.error(`下载图片失败，bosid: ${input.imageId.toString()}, error: ${dl.error}`);
      return { success: false, error: '下载图片失败，请稍后再试。' };
    }
    if (dl.file_type !== BOType.ImageJpeg) {
      console.error(`获取的文件类型不正确，bosid: ${input.imageId.toString()}, type: ${dl.file_type}`);
      return { success: false, error: '获取的文件类型不正确，输入的应该是一个对应图片的数字 id ，而不是其他类型的文件，请检查。' };
    }
    clientPushNotify(socket, `正在生成 3D 模型，请稍等...`);
    return {
      success: true,
      image: dl.data,
      imageId: input.imageId,
      imageDescription: dl.description,
    };
  });
  generate3dModelTool.setOutputHook(
    async (args, _image, model): Promise<Generate3DModelTool.Output> => {
      if (model.success === false) {
        throw new Error(`生成 3D 模型失败，不应该调用 OutputHook : ${model.error}`);
      }
      const bosid = generateSID();
      const filename = bosid.toString() + '_' + sanitize(args.modelName) + '.glb';
      const modelName: string = args.modelName;
      const modelDescription: string = args.modelDescription;
      try {
        const res = await Api.uploadBinaryObject({
          objectId: bosid,
          fileType: BOType.ModelGlb,
          saveName: filename,
          name: modelName,
          description: modelDescription,
          content: model.model,
        });
        if (!res.success)
          return { success: false, error: `上传 3D 模型失败，错误信息: ${res.error}`};
        return { success: true, modelId: bosid };
      } catch (err) {
        return { success: false, error: `上传 3D 模型失败，错误信息: ${catchToString(err)}` };
      }
  });

  render3dModelTool.setInputHook(async (input) => {
    const dl = await Api.fetchBinaryObjectInfoData(input.modelId);
    if (!dl.success) {
      console.error(`下载模型失败，bosid: ${input.modelId.toString()}, error: ${dl.error}`);
      return { success: false, error: '下载模型失败，请稍后再试。' };
    }
    if (dl.file_type !== BOType.ModelGlb) {
      console.error(`获取的文件类型不正确，bosid: ${input.modelId.toString()}, type: ${dl.file_type}`);
      return { success: false, error: '获取的文件类型不正确，输入的应该是一个对应 3D 模型的数字 id ，而不是其他类型的文件，请检查。' };
    }
    return {
      success: true,
      model: dl.data,
      modelId: input.modelId,
      modelDescription: dl.description,
    };
  });

  render3dModelTool.setOutputHook(
    async (args, _model, image): Promise<Render3DModelTool.Output> => {
      if (image.success === false) {
        throw new Error(`渲染 3D 模型失败，不应该调用 OutputHook : ${image.error}`);
      }
      const bosid = generateSID();
      const filename = bosid.toString() + '_' + sanitize(args.imageName) + '.jpg';
      const imageName: string = args.imageName;
      const imageDescription: string = args.imageDescription;
      try {
        const res = await Api.uploadBinaryObject({
          objectId: bosid, fileType: BOType.ImageJpeg,
          saveName: filename,
          name: imageName,
          description: imageDescription,
          content: image.image,
        });
        if (!res.success)
          return { success: false, error: `上传渲染图片失败，错误信息: ${res.error}`};
        if (args.showInChat) {
          clientPushImageMessage(socket, bosid);
          await uploadMediaMessage({
            msgId: generateSID(),
            chatId: context.chat?.chatId ?? BigInt(0),
            mediaType: BOType.ImageJpeg,
            mediaObjectId: bosid,
            socket,
            hasMediaData: false,
            mediaName: imageName,
          });
        }
        return { success: true, imageId: bosid };
      } catch (err) {
        return { success: false, error: `上传渲染图片失败，错误信息: ${catchToString(err)}` };
      }
  });

  return context;
}

function handleClientHello(socket: WebSocket, json: any) {
  console.log('Client says hello');
  const clientId = generateSID();
  const context = createNewContext(socket, clientId);

  const audio_params = json.audio_params;
  if (typeof audio_params === 'object') {
    const sample_rate = audio_params.sample_rate;
    const channels = audio_params.channels;
    if (typeof sample_rate === 'number') {
      context.clientSampleRate = sample_rate;
    }
    if (typeof channels === 'number') {
      context.clientChannels = channels;
    }
  }

  // demo root user id
  context.userId = BigInt(1);

  const response = {
    type: 'hello',
    transport: 'websocket',
    session_id: 'demo-session-id',
    machine_id: 0,
    use_binary_packet: true,
    audio_params: {
      format: 'opus',
      // 24kHz，表示服务器传给客户端的音频数据是 24kHz 的采样率
      // 这个数字最好和客户端的 AUDIO_OUTPUT_SAMPLE_RATE 一致。
      // 实际上因为是 Opus 编码，这个数字无关紧要。
      sample_rate: 24000,
      channels: 1,
      frame_duration: 60, // 60 ms，这个是说单个数据包包含的音频时长上限。
    },
  }
  // log
  console.log('Sending hello response:', response);
  socket.send(JSON.stringify(response));
}

/**
 * 处理客户端打开关闭会话的请求。
 * @param socket WebSocket
 * @param json 
 * format:
 * {
 *   "type": "chat",
 *   "state": "open" | "close",
 *   "chat_id": <bigint>,
 * }
 */
async function handleClientChat(socket: WebSocket, json: any) {
  console.log('Client chat state change:', json);
  const context = wsContextMap.get(socket);
  if (!context) {
    console.error('No context found for this socket');
    return;
  }
  const state = json.state;
  if (state === 'close') {
    console.log('Client closed chat session');
    // 清理上下文
    context.chat = null;
    return;
  } else if (state === 'open') {
    // handle chat open
    const chatId = BigInt(json.chat_id);
    if (typeof chatId !== 'bigint') {
      console.error('Invalid chat_id:', chatId);
      return;
    }
    const machineId = Snowflake.parse(chatId).machineId;

    // create a new chat session
    if (machineId === 0) {
      // 这里的机器 ID 是 0，表示这是一个占位符。
      context.chat = {
        chatId: BigInt(0), // 占位符
        chatName: 'New Chat',
        lastMessageIndex: 0, // 初始化消息索引
      };
      console.info('Created new chat session with placeholder chatId:', context.chat.chatId);
      clientPushChatOpen(socket, context.chat, '欢迎聊天！请开始新的对话。');
      // clientImageTest(socket);
      return;
    }

    // open an existing chat session
    try {
      const openChat = await Api.userOpenExChat(context.userId, chatId);
      if (!openChat.success) {
        throw new Error(`Failed to open existing chat session, chatId: ${chatId}`);
      }
      console.log('Opened existing chat session:', openChat);
      context.chat = {
        chatId: openChat.chat_id,
        chatName: openChat.chat_name,
        lastMessageIndex: openChat.last_message_index,
      };
      clientPushChatOpen(socket, context.chat, '欢迎回来！请继续聊天。');
      return;
    } catch (err) {
      console.error('Failed to get user open chat:', err);
      clientPushChatOpenFailed(socket, chatId, '无法打开聊天会话，请稍后再试。');
      return;
    }
  } else {
    console.error('Unknown chat state:', state);
  }
}

async function handleClientBinary(socket: WebSocket, json: any) {
  console.log('Client binary request:', json);
  const context = wsContextMap.get(socket);
  if (!context) {
    console.error('No context found for this socket');
    return;
  }
  try {
    const state = json.state;
    if (state === 'query') {
      const bosid = BigInt(json.bosid);
      if (bosid === BigInt(0)) {
        console.error('Invalid bosid:', bosid);
        socket.send(JSON.stringify({
          type: 'binary',
          state: 'error',
          message: '无效的 bosid，请检查请求格式。',
        }));
        return;
      }
      const info: Api.BinaryObjectInfoResponse = await Api.fetchBinaryObjectInfo(bosid);
      if (!info.success) {
        console.error('Failed to fetch BinaryObject info:', info);
        socket.send(JSON.stringify({
          type: 'binary',
          state: 'error',
          message: `无法获取 BinaryObject 信息，bosid: ${bosid.toString()}`,
        }));
        return;
      }
      const data = await Api.downloadBinaryObject(bosid);
      if (!data.success) {
        console.error('Failed to download BinaryObject:', data);
        socket.send(JSON.stringify({
          type: 'binary',
          state: 'error',
          message: `无法下载 BinaryObject 数据，bosid: ${bosid.toString()}`,
        }));
        return;
      }
      if (info.file_type === BOType.ImageJpeg) {
        // 发送图片数据
        clientPushImage(socket, bosid, data.data);
      } else {
        console.error('Unsupported BinaryObject type:', info.file_type);
      }
    }
  } catch (err: any) {
    console.error('Error handling client binary request:', err?.message || err);
    return;
  }
}

async function handleClientAbort(socket: WebSocket, json: any) {
  console.log('client abort request:', json);
  const context = wsContextMap.get(socket);
  if (context === undefined) {
    console.error('No context found for this socket');
    return;
  }
  context.stopTTSAudioPush(); // 停止 TTS 音频推送
}

/**
 * 
 * @param socket WebSocket
 * @param json 
 * format:
 * {
 *  "type": "listen",
 *  "state": "start" | "stop" | "detect",
 *  "mode": "auto" | "manual" | "realtime",  (if state is "start")
 *  "text": <string>,  (if state is "detect")
 * }
 * @returns 
 */
async function handleClientListen(socket: WebSocket, json: any) {
  console.log('Client listen mode change:', json);
  const context = wsContextMap.get(socket);
  if (!context) {
    console.error('No context found for this socket');
    return;
  }
  try {
    const state = json.state;
    if (state == 'start') {
      const mode = json.mode;
      if (mode == 'manual') {
        console.log('Client is in manual listen mode');
        if (context.chat === null || context.chat.chatId === BigInt(0)) {
          const chatId = generateSID();
          try {
            const chatInfo = await Api.userNewChat(context.userId, chatId, 'New Chat');
            if (!chatInfo.success) {
              throw new Error(`Failed to create new chat session, chatId: ${chatId}`);
            }
            console.log('Created new chat session:', chatInfo);
            context.chat = {
              chatId: chatInfo.chat_id,
              chatName: chatInfo.chat_name,
              lastMessageIndex: chatInfo.last_message_index,
            };
            clientPushChatOpen(socket, context.chat, '欢迎聊天！请开始新的对话。');
          } catch (err) {
            console.error('Failed to create new chat:', err);
            clientPushChatOpenFailed(socket, chatId, '无法创建新的聊天会话，请稍后再试。');
          }
        }
      } else {
        console.error('Unsupported listen mode:', mode);
      }
      return;
    } else if (state == 'stop') {
      console.log('Client stopped listening');
      const last_obj = await finishLastBinaryObject(context);
      if (last_obj === undefined) {
        return;
      }
      await handleUserAudio(last_obj, socket, context)
    }
  } catch (err) {
    console.error('Error handling client listen request:', err);
    // clientPushNotify(socket, '处理监听请求时发生错误，请稍后再试。');
    return;
  }
}

async function finishLastBinaryObject(context: DemoContext) {
  const last_bosid = context.lastAppendBosid;
  if (last_bosid === BigInt(0)) {
    console.error('No BinaryObject data to process');
    return;
  }
  const objctx = context.boMap.get(last_bosid);
  if (objctx === undefined) {
    console.error('No BinaryObject found for last bosid:', last_bosid);
    return;
  }

  // 这里和添加数据共用一个 mutex ，
  // 确保在处理最后一个 BinaryObject 时，
  // 添加数据的过程执行完毕，之后再停止追加数据。
  await objctx.mutex.runExclusive(async () => {
    const last_obj = objctx.bo;
    await last_obj.stopAppending();
    // 会用到转码的都是在这里停止的流媒体。
    await last_obj.disableAudioConversion();
  });

  const last_obj = objctx.bo;
  console.log('Processing last BinaryObject:', last_obj.toJSON());
  // filter size > 100MB
  if (last_obj.size > 100 * 1024 * 1024) { // 100MB
    console.error('BinaryObject size exceeds 100MB:', last_obj.size / 1024 / 1024, 'MB');
    return;
  }
  // Here you can save the BinaryObject to a file or process it further
  // last_obj.saveToFile('./data', `demo_${last_bosid.toString()}`, (fullPath) => {
  //   console.log(`Saved BinaryObject to ${fullPath}`);
  // });
  // delete after half second.
  // 这是一个临时的解决方案，有时候有的数据包会在 stop 之后才到达。
  // 因为这是音频数据，所以我们假设最后的数据包可以忽略。
  // 真实场景里面可能需要一个统计，确定是不重要的音频数据再丢弃。
  setTimeout(() => {
    context.boMap.delete(last_bosid);
    context.lastAppendBosid = BigInt(0); // Reset last bosid
    console.log(`Deleted BinaryObject with bosid: ${last_bosid.toString()} from map`);
  }, 500);
  return last_obj;
}

type AIReply = {
  messageId: bigint | null,
};

async function handleUserAudio(
    bo: BinaryObject, socket: WebSocket, context: DemoContext) {
  try {
    const duration = await bo.getAudioDuration();
    if (duration <= 0.8) {
      // 如果音频时长小于 0.8 秒，认为是无效的音频数据。
      // clientPushNotify(socket, '你说话的时间太短了，机器人没能听清楚。');
      console.info('Ignoring short audio data:', duration, 'seconds');
      return;
    }
  } catch (err) {
    console.error('Error getting audio duration:', err);
    clientPushNotify(socket, '音频数据格式错误，请稍后再试。');
    return;
  }
  // STT Part
  let sentence = null;
  try {
    // 这里 bo 是 Audio Wav 格式的音频数据。
    sentence = await localSTT(bo);
  } catch (err) {
    console.error('STT error:', err);
    clientPushNotify(socket, '语音识别开小差了。');
    return;
  }
  if (sentence === null) {
    clientPushNotify(socket, '语音识别不能理解你说的话。');
    return;
  }
  // if (sentence.length === 0) {
  //   // demo sentence
  //   clientPushNotify(socket, '你没有说话，只是按了下录音按钮。');
  //   return;
  // }
  if (sentence.length > 2000) {
    // 如果识别的句子太长，可能是噪音或者错误的识别结果。
    clientPushNotify(socket, '机器人没听懂你叨叨，请重新说话。');
    return;
  }

  const chatId = context.chat?.chatId || BigInt(0);
  const sttMessageId = generateSID();
  if (sentence.length > 0) {
    // 发送语音识别的结果。
    clientPushSTT(socket, sentence, sttMessageId, chatId);
    // 上传数据库
    uploadUserMessage({
      msgId: sttMessageId,
      chatId: chatId,
      userId: context.userId,
      sentence,
      audio: bo,
      socket,
    });
  }

  userMessageToLLM({
    chatId,
    socket,
    context,
    sentence,
  });
}

type UserMessageToLLMParams = {
  chatId: bigint;
  socket: WebSocket;
  context: DemoContext;
  sentence: string;
};

function userMessageToLLM(input: UserMessageToLLMParams) {
  const { chatId, socket, context, sentence } = input;
  context.llmMutex.runExclusive(async () => {
    // 确保在生成新消息的时候，停止之前的语音推送。
    // 因为可能会卡网络，然后累积两个消息需要处理。
    // 导致还是有两个消息同时推送音频的情况发生。
    // 所以这里在生成新的音频推送之前，先停止之前的 TTS 音频推送。
    context.stopTTSAudioPush(); // 停止 TTS 音频推送
    const tts = new LLMTTS(socket);
    context.ttsSessions.push(tts);

    // 这个 messageId 是巧妙地在两个回调函数之间标记同一个回复的方法。
    // 利用了两个 Hook 函数的调用顺序。
    // 工具调用的申请也会有文本回复
    context.llmHelper.setOnDeltaHook((content: string | null) => {
      if (content !== null) {
        // ai replies string message
        if (context.llmReply.messageId === null) {
          context.llmReply.messageId = generateSID();
          tts.setMessageId(context.llmReply.messageId, chatId);
        }
        if (content.length > 0) {
          tts.addText(content);
        }
      } else {
        console.log('LLM one message finished.');
        tts.addText(null);
      }
    });
    context.llmHelper.setAddMessageHook((msg: LLMMsg) => {
      if (msg.role === LLMRole.User) {
        return true;
      }
      if ('tool_calls' in msg && msg.tool_calls != null && msg.tool_calls.length > 0) {
        // 这时候 msg 的内容是工具调用的申请。
        const msgId = generateSID();
        uploadToolMessage({ msgId, chatId, msg, socket, });
        // 调用申请可能会附带一些文本内容，这里不能返回。
      }
      if (msg.role === LLMRole.Tool) {
        // 这个时候 msg 是工具调用的结果。
        const msgId = generateSID();
        uploadToolMessage({ msgId, chatId, msg, socket, });
        return true;
      }

      // 之后应该只有 AI 的文字回复了。
      if (msg.role !== LLMRole.AI) {
        console.warn(`Unexpected LLM message role: ${msg.role}`);
        return true;
      }
      if (msg.content == null) {
        return true; // 没有内容的 AI 回复，直接忽略。
      }
      if (typeof msg.content !== 'string') {
        console.warn(`AI reply content is not a string: ${typeof msg.content}`);
        return true; // 不是字符串的 AI 回复，直接忽略。
      }
      if (msg.content.length === 0) {
        console.warn('AI reply content is empty, ignoring.');
        return true; // 空内容的 AI 回复，直接忽略。
      }

      if (context.llmReply.messageId === null) {
        // 如果有文字内容，这个时候 llmReply.messageId 还是 null，
        // 表示还没有开始 TTS 会话，通常是哪里出错了
        console.warn('AI reply message id is null, should not happen.');
        return true;
      }
      const msgId = context.llmReply.messageId ?? generateSID();
      context.llmReply.messageId = null; // 清空 messageId，防止 setOnDeltaHook 重复使用。

      clientPushAI(socket, msg.content, chatId, msgId);
      // 上传 AI 的文本回答。
      tts.waitResponse().then((audio: Buffer) => {
        if (audio.length === 0) {
          throw new Error('TTS audio is empty');
        }
        uploadAIMessage({ msgId, chatId, msg, audio, socket });
      }).catch((err) => {
        console.error('TTS error:', err);
        clientPushNotify(socket, '语音合成没能成功。');
        uploadAIMessage({ msgId, chatId, msg, audio: null, socket, });
      });
      return true;
    });

    try {
      // TODO: 防止 AI 单词过多，超过 2000 个字符。
      const lastText = await context.llmHelper.nextTextReply(sentence);
      context.clearOutdatedTTS();
      if (lastText == null || lastText.length === 0) {
        // AI 没有给出回答。
        clientPushNotify(socket, 'AI 没有说话。');
        return;
      }
    } catch (err) {
      clientPushNotify(socket, 'AI 不愿意回答你说的话。');
      console.error('LLM error:', catchToString(err));
      // console.error('LLM error:', err);
    }
  });
}

async function localSTT(bo: BinaryObject): Promise<null | string> {
  // local funasr part
  try {
    const asrdata = await runASR(bo.bosid, bo.buf);
    console.log("ASR returns:", asrdata);
    const asrres = asrdata.result;
    if (asrres.length === 0) {
      return null;
    }
    const asrstr = asrres[0].text;
    if (typeof asrstr !== 'string') {
      console.error('ASR type error.');
      return null;
    }
    return asrstr;
  } catch (e) {
    console.error("ASR error:", e);
    return null;
  }
}

// client-server part.

function clientPushChatOpen(socket: WebSocket, chat: FocusChat, welcome_text: string | undefined) {
  const response = {
    type: 'chat',
    state: 'open',
    chat_id: chat.chatId.toString(),
    chat_name: chat.chatName,
    last_message_index: chat.lastMessageIndex,
    welcome_text: welcome_text || '',
  };
  socket.send(JSON.stringify(response));
}

function clientPushChatOpenFailed(socket: WebSocket, chatId: bigint, message: string) {
  socket.send(JSON.stringify({
    type: 'chat',
    state: 'error',
    chat_id: chatId.toString(),
    message,
  }));
}

/**
 * 发送提示句子给客户端
 * @param socket WebSocket
 * @param sentence string
 * 发送给客户端句子的 JSON 格式如下
 * {
 *  "type": "tts",
 *  "state": "sentence_start",
 *  "text": <string>,
 *  }
 */
function clientPushNotify(socket: WebSocket, sentence: string) {
  console.log(`clientPushNotify: ${sentence}`);
  const response = {
    type: 'tts',
    state: 'sentence_start',
    text: sentence,
  };
  socket.send(JSON.stringify(response));
}

function clientPushAIDelta(
    socket: WebSocket, delta: string,
    chatId: bigint, aiMessageId: bigint, chunkIndex: number) {
  console.log(`clientPushAIDelta: ${delta}`);
  const msg = {
    type: 'message',
    state: 'delta',
    chat_id: chatId.toString(),
    message_id: aiMessageId.toString(),
    chunk_index: chunkIndex,
    role: 'ai',
    message_type: BOType.RawText,
    delta,
  };
  console.log('Sending AI delta message:', msg);
  socket.send(JSON.stringify(msg));
}

function clientPushAI(
    socket: WebSocket, sentence: string,
    chatId: bigint, aiMessageId: bigint) {
  console.log(`clientPushAI: ${sentence}`);
  // TODO: 暂时在这里直接发送完整的句子。
  clientPushSentence(socket, sentence, true);
  const msg = {
    type: 'message',
    state: 'new',
    chat_id: chatId.toString(),
    message_id: aiMessageId.toString(),
    role: 'ai',
    message_type: BOType.RawText,
    content: sentence,
  };
  console.log('Sending AI message:', msg);
  socket.send(JSON.stringify(msg));
}

function clientPushSentence(
    socket: WebSocket, sentence: string, begin: boolean) {
  console.log(`clientPushSentence: ${sentence} ${begin ? 'start' : 'end'}`);
  const response = {
    type: 'tts',
    state: begin ? 'sentence_start' : 'sentence_end',
    text: sentence,
  };
  socket.send(JSON.stringify(response));
}

function clientPushTTSState(socket: WebSocket, isRunning: boolean) {
  console.log(`clientPushTTSState: ${isRunning ? 'start' : 'stop'}`);
  const response = {
    type: 'tts',
    state: isRunning ? 'start' : 'stop',
  };
  socket.send(JSON.stringify(response));
}


/**
 * 发送语音识别的结果给客户端
 */
function clientPushSTT(
    socket: WebSocket, sentence: string,
    sttMessageId: bigint, chatId: bigint) {
  console.log(`clientPushSTT: ${sentence}`);
  const response = {
    type: 'stt',
    text: sentence,
  };
  socket.send(JSON.stringify(response));
  const msg = {
    type: 'message',
    state: 'new',
    chat_id: chatId.toString(),
    message_id: sttMessageId.toString(),
    role: 'user',
    message_type: BOType.RawText,
    content: sentence,
  };
  console.log('Sending STT message:', msg);
  socket.send(JSON.stringify(msg));
}

function clientPushMessageIndex(socket: WebSocket, line: Api.NewMessageResponse) {
  const msg = {
    type: 'chat',
    state: 'index',
    chat_id: line.chat_id.toString(),
    message_id: line.message_id.toString(),
    message_index: line.message_index,
  };
  console.log('Sending index update:', msg);
  socket.send(JSON.stringify(msg));
}

function clientPushAudio(socket: WebSocket, oggPacket: OggPacket) {
  const bosid = generateSID();
  const obj = new BinaryObject();
  obj.fromProps(bosid, BOType.AudioOpusFrame, oggPacket.length);
  obj.appendDataRaw(oggPacket);
  obj.stopAppendingSync(); // Mark the object as complete
  // console.log('Sending audio with bosid:', bosid.toString(), ", size:", obj.size);
  const packetSize = 1800;
  obj.toBinaryPackets(packetSize).forEach(packet => {
    const buffer = packet.toBuffer();
    socket.send(buffer);
  });
}

function clientPushImageMessage(socket: WebSocket, bosid: bigint) {
  const info = { type: 'image', bosid: bosid.toString() };
  // Send the image info to the client
  console.log('Sending image message with bosid:', bosid.toString());
  socket.send(JSON.stringify(info));
}

/**
 * 发送图片给客户端
 * @param socket WebSocket
 * @param bosid bigint
 * @param imageData Buffer
 * 给客户端发送多个 BinaryPacket 数据包。
 * 数据包是 BinaryObject buffer 载入图片数据之后，切分出来的。
 */
function clientPushImage(socket: WebSocket, bosid: bigint, imageData: Buffer) {
  (async () => {
    // resize image to fit screen.
    imageData = await resizeImageFit(imageData);
    // Create a BinaryObject and append the image data
    const obj = new BinaryObject();
    obj.fromProps(bosid, BOType.ImageJpeg, imageData.length);
    obj.appendDataRaw(imageData);
    obj.stopAppendingSync(); // Mark the object as complete
    console.log('Sending image with bosid:', bosid.toString(), ", size:", obj.size);
    // Send the BinaryObject as multiple BinaryPackets
    const packetSize = 1800; // Example packet size
    obj.toBinaryPackets(packetSize).forEach(packet => {
      const buffer = packet.toBuffer();
      console.log('Sending BinaryPacket with bosid:', packet.header.bosid.toString(), 
          ", offset:", packet.header.offset,
          ", frame_size:", packet.header.frameSize);
      socket.send(buffer);
    });
  })().catch((err) => {
    console.error('Error sending image:', err);
  });
}

async function clientPushSampleImage(socket: WebSocket) {
  // read an image file and send it to the client
  // Path to your test image
  const imagePath = path.join(__dirname, '../data/media/sample.jpg');
  try {
    const imageData = await fs.promises.readFile(imagePath);
    console.log('Read image data from file:', imagePath);
    const bosid = generateSID();
    console.log('Generated bosid for image:', bosid.toString());
    clientPushImageMessage(socket, bosid);
    clientPushImage(socket, bosid, imageData);
  } catch (err) {
    console.error('Failed to read image file:', err);
    clientPushNotify(socket, '无法读取测试图片，请检查文件路径。');
  }
}


// web api part.

/**/
async function runASR(bosid: bigint, audio: Buffer) {
  // TODO: check output json format.
  const form = new FormData();
  form.set('audio', new Blob([audio], { type: 'audio/wav' }), 'asr.wav');
  const encoder = new FormDataEncoder(form);
  return axios.post(ASR_URL, Readable.from(encoder.encode()), {
    headers: {
      'X-Task-Id': bosid.toString(),
      'X-language': 'zh',
      ...encoder.headers,
    },
  }).then(response => response.data).catch(error => {
    console.error('Error during ASR request:', error);
    throw error;
  });
}

type UploadUserMessageInput = {
  msgId: bigint;
  chatId: bigint;
  userId: bigint;
  audio?: BinaryObject;
  sentence: string;
  socket: WebSocket;
};
// upload user message to server
async function uploadUserMessage(input: UploadUserMessageInput): Promise<void> {
  try {
    const res = await Api.newTextMessage({
        messageId: input.msgId,
        chatId: input.chatId,
        senderType: SenderType.User,
        senderId: input.userId,
        content: input.sentence});
    if (!res.success) {
      console.error('Failed to insert user message:', res.error);
      return;
    }
    console.info('user message inserted successfully:', res);
    clientPushMessageIndex(input.socket, res);
    // 上传音频。
    // convert wav to ogg.
    if (input.audio === undefined || input.audio.size === 0) {
      console.info('User audio data is empty, skipping upload.');
      return;
    }
    const oggBuf = await input.audio.toOggBuffer();
    const resp = await Api.uploadChatAudio({
      objectId: input.msgId,
      saveName: `${input.msgId}.ogg`,
      description: input.sentence,
      content: oggBuf
    });
    if (!resp.success) {
      console.error('Failed to upload user audio:', resp.error);
      return;
    }
    console.log('user audio uploaded successfully:', resp);
  } catch (err) {
    console.error('Failed to upload user message:', catchToString(err));
  }
}

type UploadAIMessageInput = {
  msgId: bigint;
  chatId: bigint;
  msg: LLMMsg;
  audio: Buffer | null; // AI 的音频数据
  socket: WebSocket;
};
async function uploadAIMessage(input: UploadAIMessageInput): Promise<void> {
  try {
    // 这里的 msg.role 是 LLMRole.AI 或者 LLMRole.Tool 或者 LLMRole.System。
    const role = input.msg.role;
    const sentence: string = input.msg.content as string;
    if (typeof sentence !== 'string') {
      console.error(`AI message content is not a string: ${typeof sentence}, should not happen.`);
      return;
    }
    const res = await Api.newTextMessage({
      messageId: input.msgId,
      chatId: input.chatId,
      senderType: llmMsgToSenderType(role),
      senderId: BigInt(1),  // TODO: 这里替换成 AI Avatar 的 ID。
      content: sentence,
    });
    if (!res.success) {
      console.error('Failed to upload AI message:', res.error);
      return;
    }
    console.log('AI message uploaded successfully:', res);
    clientPushMessageIndex(input.socket, res);

    // 在消息保存成功之后，再开始 TTS 结果的上传。
    if (role === LLMRole.AI) {
      if (input.audio === null) {
        console.warn('AI audio data is null, skipping upload.');
        return;
      }
      const resp = await Api.uploadChatAudio({
        objectId: input.msgId,
        saveName: `${input.msgId}.ogg`,
        description: sentence,
        content: input.audio,
      });
      if (!resp.success) {
        console.error('Failed to upload AI audio:', resp.error);
        return;
      }
      console.log('AI audio uploaded successfully:', resp);
    }
  } catch (err) {
    console.error('Failed to upload AI message:', catchToString(err));
  }
}

type UploadToolMessageInput = {
  msgId: bigint;
  chatId: bigint;
  msg: LLMMsg;
  socket: WebSocket;
}
async function uploadToolMessage(input: UploadToolMessageInput): Promise<void> {
  try {
    const msg = input.msg;
    let senderType: SenderType;
    let content: string;
    if (msg.role === LLMRole.AI
      && 'tool_calls' in msg && msg.tool_calls != null
      && msg.tool_calls.length > 0) {
      // tool request
      senderType = SenderType.AI;
      content = JSON.stringify(msg.tool_calls);
    } else if (msg.role === LLMRole.Tool) {
      senderType = SenderType.Tool;
      content = msg.content;
    } else {
      throw new Error(`Unexpected LLM message role: ${msg.role}`);
    }
    const res = await Api.newToolMessage({
      messageId: input.msgId,
      chatId: input.chatId,
      senderType,
      senderId: BigInt(1), // TODO: 这里替换成 Tool Avatar 的 ID。
      content,
    });
    if (!res.success) {
      console.error('Failed to upload tool message:', res.error);
      return;
    }
    console.log('Tool message uploaded successfully:', res);
    clientPushMessageIndex(input.socket, res);
  } catch (err) {
    console.error('Failed to upload tool message:', catchToString(err));
  }
}

type UploadMediaMessageInput = {
  msgId: bigint;
  chatId: bigint;
  mediaType: BOType;
  mediaObjectId: bigint;
  socket: WebSocket;
  mediaName?: string;
} & ({
  hasMediaData: false;
} | {
  // 媒体数据，如果有的话直接上传，没有的话表示引用现有的 media 对象。
  hasMediaData: true;
  saveName: string;
  description: string;
  mediaData: Buffer;
});

async function uploadMediaMessage(input: UploadMediaMessageInput): Promise<void> {
  try {
    // 如果有媒体数据，直接上传
    if (input.hasMediaData === true) {
      const res_up = await Api.uploadBinaryObject({
        objectId: input.mediaObjectId,
        saveName: input.saveName,
        description: input.description,
        content: input.mediaData,
        fileType: input.mediaType,
        name: input.mediaName,
      });
      if (!res_up.success) {
        console.error('Failed to upload media object:', res_up.error);
        throw new Error(`Failed to upload media object: ${res_up.error}`);
      }
      console.log('Media object uploaded successfully:', res_up);
    }

    // 上传媒体消息
    const res_msg = await Api.newMediaMessage({
      messageId: input.msgId,
      chatId: input.chatId,
      senderType: SenderType.AI,
      senderId: BigInt(1), // TODO: 这里替换成 AI Avatar 的 ID。
      mediaType: input.mediaType,
      mediaObjectId: input.mediaObjectId,
      mediaName: input.mediaName,
    });
    if (!res_msg.success) {
      console.error('Failed to upload media message:', res_msg.error);
      throw new Error(`Failed to upload media message: ${res_msg.error}`);
    }
    console.log('Media message uploaded successfully:', res_msg);
    clientPushMessageIndex(input.socket, res_msg);
  } catch (err) {
    console.error('Failed to upload media message:', catchToString(err));
  }
}

async function resizeImageFit(imageBuffer: Buffer): Promise<Buffer> {
  const meta = await sharp(imageBuffer).metadata();
  const { width, height } = meta;
  const maxWidth = 300; // 最大宽度
  const maxHeight = 240; // 最大高度
  const resizeRatio = Math.min(maxWidth / width, maxHeight / height, 1);
  console.log(`Resizing image from ${width}x${height} to fit within ${maxWidth}x${maxHeight}`);
  return sharp(imageBuffer)
    .resize(Math.round(width * resizeRatio), Math.round(height * resizeRatio),
          { fit: 'inside', withoutEnlargement: true })
    .toBuffer();
}

class LLMTTS {
  private collector = new ChunkCollector();
  private ttsSpeaker: string = 'default';
  private tts = new TTSStreamQueue(() => {
    const vol = new TTSStreamVolcano();
    vol.setSpeaker(this.ttsSpeaker);
    return vol;
  });
  private reader = new OggStreamReader();
  private packetCache: OggPacket[] = [];
  private socket: WebSocket;
  private messageId: bigint = BigInt(0);
  private chatId: bigint = BigInt(0); // 当前聊天的 ID
  private chunkIndex: number = 0;

  private enableAudioPush: boolean = true; // 是否允许推送音频数据
  // audio queue 是等待推送给客户端的音频数据。
  // 它是一个 OggPacket 数组，表示按每次的发送量合并后的音频数据包。
  // 因为客户端的音频队列长度有限，所以较长的音频数据需要分批发送。
  private audioQueue: Denque<OggPacket> = new Denque<OggPacket>();
  private queueTimer: NodeJS.Timeout | null = null;

  constructor(socket: WebSocket) {
    this.socket = socket;
    this.collector.setValues(5, 1000);
    this.collector.setChunkHook(this.onChunk.bind(this));
    // TODO: TTS Stream Volcano 里面还有很多调节参数没有设置。
    this.tts.setOnDeltaHook(this.onTTSDelta.bind(this));
    this.reader.setOnPacketHook(this.onOggPacket.bind(this));
    // 这里暂时不推送。
    // this.tts.setOnSentenceHook((sentence: TTSSentence, begin: boolean) => {
    //   clientPushSentence(socket, sentence.text, begin);
    // });
  }
  isEmpty(): boolean { return this.tts.isEmpty() && this.audioQueue.length === 0; }
  setMessageId(msgId: bigint, chatId: bigint) {
    this.messageId = msgId;
    this.chatId = chatId;
    this.chunkIndex = 0;
  }
  setSpeaker(speaker: string) { this.ttsSpeaker = speaker; }
  setAudioPush(enable: boolean) {
    this.enableAudioPush = enable;
    if (enable) {
      console.log('Audio push enabled.');
      this.pushQueue(Buffer.alloc(0)); // 触发一次音频发送
    }
  }
  addText(text: string | null) {
    this.collector.addText(text);
  }
  async waitResponse(): Promise<Buffer> {
    return await this.tts.waitResponse();
  }

  private onChunk(chunk: string, trigger: ChunkCollector.Trigger) {
    console.log(`Received collected chunk: ${chunk}, length: ${chunk.length}`);
    if (chunk.length > 0) {
      this.tts.push(chunk);
      // clientPushAIDelta(this.socket, chunk,
      //     this.chatId, this.messageId, this.chunkIndex++);
    }
    if (trigger === ChunkCollector.Trigger.End) {
      console.log('TTS chunk collection ended, flushing remaining packets.');
      this.tts.push(null); // 结束 TTS 流
    }
  }
  private onTTSDelta(data: Buffer | null) {
    if (data === null) {
      console.log('TTS end of stream.');
      this.flushOggPacketCache();
      return;
    }
    // 这个是同步的，直接回调 onOggPacket。
    this.reader.readData(data);
  }
  private onOggPacket(packet: OggPacket, _header: OggPageHeader) {
    const meta = OggPacket.parseAudioMetadata(packet);
    if (!meta) { return; }
    if (meta.frameSize !== 20) {
      console.warn(`Unexpected frame size: ${meta.frameSize}, expected 20`);
      return;
    }
    this.packetCache.push(packet);
    if (this.packetCache.length === 3) { this.flushOggPacketCache(); }
  }
  private flushOggPacketCache() {
    if (this.packetCache.length === 0) { return; }
    const merged: OggPacket = OggPacket.mergePackets(this.packetCache);
    this.packetCache = []; // Clear the cache
    if (this.enableAudioPush) {
      // 推给客户端之前需要延时等到正确的时间点。
      // console.log(`Flushing OggPacket with length ${merged.length} to client.`);
      this.pushQueue(merged);
    }
  }

  private pushQueue(packet: OggPacket) {
    if (packet.length > 0)
      this.audioQueue.push(packet);
    if (this.queueTimer === null) {
      this.pushTTSStart();
      this.triggerSendAudio();
    }
  }

  // 函数的规则是如果队列有成员，那么推送一个包裹并且设置一个定时器，
  // 经过 92% 的播放时间之后再次触发这个函数。
  private triggerSendAudio() {
    if (this.enableAudioPush === false) {
      // 不要推送音频或者控制数据，保持静默状态。
      return;
    }
    if (this.audioQueue.length === 0) {
      console.log('Audio queue is empty, stopping timer.');
      this.clearTimer();
      this.pushTTSStopDelayed(1500);
      return;
    }
    // cannot be undefined, because we check length above.
    const packet: OggPacket = this.audioQueue.shift() as OggPacket;
    const audioTime = 60; // TODO: 计算音频包的播放时间
    this.resetTimer(audioTime * 0.92);
    clientPushAudio(this.socket, packet);
  }

  private clearTimer() {
    if (this.queueTimer) {
      clearTimeout(this.queueTimer);
      this.queueTimer = null;
    }
  }

  private resetTimer(timeoutMs: number) {
    this.clearTimer();
    this.queueTimer = setTimeout(() => {
      this.triggerSendAudio();
    }, timeoutMs);
  }

  private pushTTSStart() {
    console.log('Pushing start for TTS stream.');
    clientPushTTSState(this.socket, true);
  }

  private pushTTSStop() {
    console.log('Pushing stop for TTS stream.');
    clientPushTTSState(this.socket, false);
  }

  private pushTTSStopDelayed(delayMs: number) {
    setTimeout(() => {
      if (this.queueTimer) {
        // 如果有定时器，说明还有音频在发送中
        console.log('TTS stream is still running, not stopping yet.');
        return;
      }
      this.pushTTSStop();
    }, delayMs);
  }
}
