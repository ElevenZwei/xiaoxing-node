import { WebSocket, RawData, WebSocketServer } from 'ws';
import axios from 'axios';
import FormData from 'form-data';

import { BinaryObject, BinaryPacket, BOType, Snowflake } from './binary_packet';
import { LLMHelper, LLMProvider, LLMTool, LLMMsg } from './llm_demo';
import * as Api from './api_query';

const id_gen = new Snowflake(0x24);
function generateSID(): bigint {
  return id_gen.generate();
}
const ASR_URL = 'http://localhost:8000/recognize'; // Example ASR service URL

enum SenderType {
  User = 0x4001,
  AI = 0x4002,
  Tool = 0x4003,
  Hidden = 0x4004,
};
function llmMsgToSenderType(role: string): SenderType {
  switch (role) {
    case 'user':
      return SenderType.User;
    case 'assistant':
      return SenderType.AI;
    case 'tool':
      return SenderType.Tool;
    default:
      console.warn(`Unknown role: ${role}, defaulting to hidden`);
      return SenderType.Hidden;
  }
}

export function wsEchoHandler(wss: WebSocketServer) {
  wss.on('connection', (socket: WebSocket) => {
    handleEchoConnection(socket);
  });
}

function handleEchoConnection(socket: WebSocket) {
  console.log('WebSocket echo connection established');
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
        await wsBinaryHandler(socket, Buffer.from(message as ArrayBuffer));
      } else {
        const msg = message.toLocaleString();
        wsMessageHandler(socket, msg);
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      wsErrorHandler(socket, error as Error);
    }
  });
  socket.on('close', () => {
    console.log('WebSocket connection closed');
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

class DemoContext {
  clientId: bigint;
  userId: bigint = BigInt(0); // demo user id is 0
  chat: FocusChat | null = null;

  boMap: Map<bigint, BinaryObject> = new Map();
  lastAppendBosid: bigint = BigInt(0);

  clientSampleRate: number = 16000;
  clientChannels: number = 1;
  llmHelper: LLMHelper;
  constructor(clientId: bigint, helper: LLMHelper) {
    this.clientId = clientId;
    this.llmHelper = helper;
  }
};
const wsContextMap = new WeakMap<WebSocket, DemoContext>();

function wsMessageHandler(socket: WebSocket, message: string) {
  if (typeof message !== 'string') {
    console.error('Received non-string message:', message);
    return;
  }
  console.log('Received message:', message);
  const msg_json = JSON.parse(message);
  const type = msg_json.type;
  if (type == 'hello') {
    // client hello
    handleClientHello(socket, msg_json);
    return;
  } else if (type == 'chat') {
    handleClientChat(socket, msg_json);
  } else if (type == 'listen') {
    // client listen mode change.
    handleClientListen(socket, msg_json);
    return;
  }
}

async function wsBinaryHandler(socket: WebSocket, message: Buffer) {
  console.log('Received binary message:', message);
  // Here you can handle binary messages, e.g., audio data
  const context = wsContextMap.get(socket);
  if (!context) {
    console.error('No context found for this socket');
    return;
  }
  // Parse the binary message into a BinaryPacket
  const packet = BinaryPacket.fromBuffer(message);
  console.log('Parsed BinaryPacket Header:', packet.header.toJSON());
  // Store the packet in the context's map
  if (packet.header.bosid !== context.lastAppendBosid) {
    context.lastAppendBosid = packet.header.bosid;
  }
  let obj = context.boMap.get(packet.header.bosid);
  if (!obj) {
    obj = new BinaryObject();
    obj.fromHeader(packet.header);
    await obj.enableAudioConversion(context.clientSampleRate, context.clientChannels);
    context.boMap.set(packet.header.bosid, obj);
    console.log('New BinaryObject started with bosid:', obj.bosid);
  }
  obj.appendDataWithConversion(packet.data);

  if (packet.header.isLastFrame) {
    obj.stopAppending();
    console.log('Received complete BinaryObject:', obj.toJSON());
  }
}

function wsErrorHandler(socket: WebSocket, error: Error) {
  console.error('WebSocket error:', error);
  // Handle WebSocket errors, e.g., log them or notify the client
  socket.close(1000, 'Error occurred');
}

function createNewContext(clientId: bigint): DemoContext {
  const systemPrompt = 
    `你是一个活泼友好的年轻女孩，你现在在和用户聊天，你很乐于帮助他解决问题，你需要保持日常聊天的对话风格来回应。你所说的话会经过语音合成传递给用户，所以请不要输出难以朗读的部分，也不要使用表情符号。你应该使用日常对话的方式代替括号等书面表达。`;
  const helper = new LLMHelper(
      LLMProvider.OpenRouter, 'openai/gpt-4o',
      20, systemPrompt, undefined);
  const context = new DemoContext(clientId, helper);
  return context;
}


function handleClientHello(socket: WebSocket, json: any) {
  console.log('Client says hello');
  const clientId = generateSID();
  const context = createNewContext(clientId);
  wsContextMap.set(socket, context);

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
      // 采样率是 24000Hz，单声道，帧长 60ms。
      // 60ms 的帧长，表示每个音频包的大小是 24000 * 0.06 = 1440 字节。
      sample_rate: 24000,
      channels: 1,
      frame_duration: 60, // 60 ms
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
  }
  if (state === 'open') {
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
      sendChatOpen(socket, context.chat, '欢迎使用聊天功能！请开始新的对话。');
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
      sendChatOpen(socket, context.chat, '欢迎回来！请继续聊天。');
      return;
    } catch (err) {
      console.error('Failed to get user open chat:', err);
      sendChatOpenFailed(socket, chatId, '无法打开聊天会话，请稍后再试。');
      return;
    }
  }
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
          sendChatOpen(socket, context.chat, '欢迎使用聊天功能！请开始新的对话。');
        } catch (err) {
          console.error('Failed to create new chat:', err);
          sendChatOpenFailed(socket, chatId, '无法创建新的聊天会话，请稍后再试。');
        }
      }
    } else {
      console.error('Unsupported listen mode:', mode);
    }
    return;
  }
  if (state == 'stop') {
    console.log('Client stopped listening');
    const last_obj = finishLastBinaryObject(context);
    if (last_obj === undefined) {
      return;
    }
    await handleUserAudio(last_obj, socket, context)
  }
}

function finishLastBinaryObject(context: DemoContext) {
  const last_bosid = context.lastAppendBosid;
  if (last_bosid === BigInt(0)) {
    console.error('No BinaryObject data to process');
    return;
  }
  const last_obj = context.boMap.get(last_bosid);
  if (!last_obj) {
    console.error('No BinaryObject found for last bosid:', last_bosid);
    return;
  }
  last_obj.stopAppending();
  // 会用到转码的都是在这里停止的流媒体。
  last_obj.disableAudioConversion();
  console.log('Processing last BinaryObject:', last_obj.toJSON());
  // filter size > 100MB
  if (last_obj.size > 100 * 1024 * 1024) { // 100MB
    console.error('BinaryObject size exceeds 100MB:', last_obj.size / 1024 / 1024, 'MB');
    return;
  }
  // Here you can save the BinaryObject to a file or process it further
  last_obj.saveToFile('./data', `demo_${last_bosid.toString()}`, (fullPath) => {
    console.log(`Saved BinaryObject to ${fullPath}`);
  });
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
  text: string | null,
  messageId: bigint | null,
};

async function handleUserAudio(
    bo: BinaryObject, socket: WebSocket, context: DemoContext) {
  let sentence = null;
  try {
    sentence = await localSTT(bo);
  } catch (err) {
    sendNotification(socket, '语音识别没能成功。');
    throw err;
  }
  if (sentence === null) {
      sendNotification(socket, '语音识别没有给出回答。');
      return;
  }
  // if (sentence.length === 0) {
  //   // demo sentence
  //   sendNotification(socket, '你没有说话，只是按下了录音按钮。');
  //   return;
  // }
  if (sentence.length > 2000) {
    // 如果识别的句子太长，可能是噪音或者错误的识别结果。
    sendNotification(socket, '语音识别结果过长，请重新说话。');
    return;
  }
  const chatId = context.chat?.chatId || BigInt(0);

  if (sentence.length > 0) {
    const sttMessageId = generateSID();
    // 发送语音识别的结果。
    sendSTT(socket, sentence, sttMessageId, chatId);
    // TODO: 上传音频。
  }

  // LLM 通信
  const aiReply: AIReply = {
    text: null,
    messageId: null,
  };
  try {
    context.llmHelper.setAddMessageHook((msg: LLMMsg) => {
      const msgId = generateSID();
      if (typeof msg.content === 'string' && msg.content.length > 0) {
        aiReply.messageId = msgId;
        // 上传用户的对话以及 AI 的回答。
        Api.newTextMessage({
          messageId: msgId,
          chatId: chatId,
          senderType: llmMsgToSenderType(msg.role),
          senderId: context.userId,
          content: msg.content,
          withAudio: false,
        }).then((res) => {
          if (!res.success) {
            console.error('Failed to upload AI message:', res.error);
            return;
          }
          console.log('AI message uploaded successfully:', res);
          sendIndexUpdate(socket, res);
        });
      }
      return true;
    });
    aiReply.text = await context.llmHelper.nextTextReply(sentence);
    context.llmHelper.setAddMessageHook(undefined);
  } catch (err) {
    sendNotification(socket, 'AI 通信没能成功。');
    throw err;
  }
  // 发送 LLM 的回答。
  if (aiReply.text !== null && aiReply.text.length > 0) {
    if (aiReply.messageId === null) {
      console.warn('AI reply messageId is null, generating a new one.');
      aiReply.messageId = generateSID();
    }
    sendAIReply(socket, aiReply.text, aiReply.messageId, chatId);
  } else {
    sendNotification(socket, 'AI 没有给出回答。');
  }
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

function sendChatOpen(socket: WebSocket, chat: FocusChat, welcome_text: string | undefined) {
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

function sendChatOpenFailed(socket: WebSocket, chatId: bigint, message: string) {
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
function sendNotification(socket: WebSocket, sentence: string) {
  console.log(`sendNotification: ${sentence}`);
  const response = {
    type: 'tts',
    state: 'sentence_start',
    text: sentence,
  };
  socket.send(JSON.stringify(response));
}


function sendAIReply(
    socket: WebSocket, sentence: string,
    aiMessageId: bigint, chatId: bigint) {
  console.log(`sendAIReply: ${sentence}`);
  const response = {
    type: 'tts',
    state: 'sentence_start',
    text: sentence,
  };
  socket.send(JSON.stringify(response));
  const msg = {
    type: 'message',
    state: 'new',
    chat_id: chatId.toString(),
    message_id: aiMessageId.toString(),
    role: 'ai',
    message_type: BOType.RawText,
    content: sentence,
  };
  socket.send(JSON.stringify(msg));
}


/**
 * 发送语音识别的结果给客户端
 */
function sendSTT(socket: WebSocket, sentence: string,
                sttMessageId: bigint, chatId: bigint) {
  console.log(`sendSTT: ${sentence}`);
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
  socket.send(JSON.stringify(msg));
}

function sendIndexUpdate(socket: WebSocket, line: Api.NewMessageResponse) {
  const msg = {
    chat_id: line.chat_id.toString(),
    message_id: line.message_id.toString(),
    message_index: line.message_index,
  };
  socket.send(JSON.stringify(msg));
}

/**
 * 发送图片给客户端
 * @param socket WebSocket
 * @param imageData Buffer
 * 发送给客户端图片的 JSON 格式如下
 * { "type": "image", "bosid": <bigint> }
 * 其中 bosid 是一个唯一的 ID，用于标识这张图片。
 * 然后是许多个 BinaryPacket 数据包。
 * 数据包是 BinaryObject buffer 载入图片数据之后，切分出来的。
 */
function sendImage(socket: WebSocket, imageData: Buffer) {
  const bosid = generateSID();
  const response = {
    type: 'image',
    bosid: bosid.toString(),
  };
  socket.send(JSON.stringify(response));

  // Create a BinaryObject and append the image data
  const obj = new BinaryObject();
  obj.fromProps(bosid, BOType.ImageJpeg, imageData.length);
  obj.appendDataRaw(imageData);
  obj.stopAppending(); // Mark the object as complete
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
}


// web api part.

/**/
async function runASR(bosid: bigint, audio: Buffer) {
  const form = new FormData();
  form.append('audio', audio, {
    filename: 'asr.wav',
    contentType: 'audio/wav',
  });
  return axios.post(ASR_URL, form, {
    headers: {
      'X-Task-Id': bosid.toString(),
      'X-language': 'zh',
      ...form.getHeaders(),
    },
  }).then(response => response.data).catch(error => {
    console.error('Error during ASR request:', error);
    throw error;
  });
}

