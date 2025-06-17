import { WebSocket, RawData, WebSocketServer } from 'ws';
import fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';
import { Mutex } from 'async-mutex';
import Denque from 'denque';

import { BinaryObject, BinaryPacket, BOType, Snowflake } from './binary_packet';
import { LLMRole, LLMHelper, LLMProvider, LLMTool, LLMMsg, ChunkCollector } from './llm_helper';
import * as Api from './api_query';
import { TTSSentence, TTSStreamVolcano } from './tts_stream_helper';
import { OggPageHeader, OggStreamReader, OggPacket } from './media';

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
type ObjectContext = {
  bo: BinaryObject;
  mutex: Mutex;
};

class DemoContext {
  clientId: bigint;
  userId: bigint = BigInt(0); // demo user id is 0
  chat: FocusChat | null = null;

  boMap: Map<bigint, ObjectContext> = new Map();
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

function wsBinaryHandler(socket: WebSocket, message: Buffer) {
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
    // 这里的 await 迫使我们在外层还要再加一层 Mutex ，确保 BinaryHandler 保持收到的数据顺序。
    // 不然第一个回调卡在这个 await 的时候，第二个回调会更早插入 appendData 的队列，
    // 然后第一个回调的数据反而在后面。
    await obj.enableAudioConversion(context.clientSampleRate, context.clientChannels);
    await obj.appendDataWithConversion(packet.data);
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
    const last_obj = await finishLastBinaryObject(context);
    if (last_obj === undefined) {
      return;
    }
    await handleUserAudio(last_obj, socket, context)
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
  // STT Part
  let sentence = null;
  try {
    sentence = await localSTT(bo);
  } catch (err) {
    console.error('STT error:', err);
    clientPushNotify(socket, '语音识别没能成功。');
    return;
  }
  if (sentence === null) {
      clientPushNotify(socket, '语音识别没有给出回答。');
      return;
  }
  // if (sentence.length === 0) {
  //   // demo sentence
  //   clientPushNotify(socket, '你没有说话，只是按下了录音按钮。');
  //   return;
  // }
  if (sentence.length > 2000) {
    // 如果识别的句子太长，可能是噪音或者错误的识别结果。
    clientPushNotify(socket, '语音识别结果过长，请重新说话。');
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

  const tts = new LLMTTS(socket);
  // LLM 通信
  const aiReply: AIReply = {
    text: null,
    messageId: null,
  };

  // 这个 messageId 是巧妙地在两个回调函数之间标记同一个回复的方法。
  // 利用了两个 Hook 函数的调用顺序。
  let last_message_id = BigInt(0);
  let delta_chunk_index = 0;
  let ai_string_reply_cnt = 0;
  context.llmHelper.setOnDeltaHook((content: string | null) => {
    if (content !== null) {
      // ai replies string message
      if (last_message_id === BigInt(0)) {
        last_message_id = generateSID();
        tts.setMessageId(last_message_id, chatId);
      }
      ++delta_chunk_index;
      console.log(`LLM reply messageId: ${last_message_id}, `
                  + `chunk: ${delta_chunk_index}, delta: ${content}`);
      if (content.length > 0) {
        tts.addText(content);
      }
    } else {
      console.log('LLM one message finished.');
      tts.addText(null);
    }
  });
  context.llmHelper.setAddMessageHook((msg: LLMMsg) => {
    if (typeof msg.content !== 'string' || msg.content.length === 0|| msg.role === LLMRole.User) {
      return true;
    }
    // 这是一个 move last_message_id 的操作，利用 onDeltaHook 的调用顺序在 addMessageHook 之前。
    const msgId = last_message_id === BigInt(0) ? generateSID() : last_message_id;
    last_message_id = BigInt(0);
    delta_chunk_index = 0;
    aiReply.messageId = msgId;
    // 上传 AI 的回答。
    (async () => {
      // 这里的 msg.role 是 LLMRole.AI 或者 LLMRole.Tool 或者 LLMRole.System。
      const res = await Api.newTextMessage({
        messageId: msgId,
        chatId: chatId,
        senderType: llmMsgToSenderType(msg.role),
        senderId: BigInt(1),
        content: msg.content as string,
      });
      if (!res.success) {
        console.error('Failed to upload AI message:', res.error);
        await tts.waitFinish(); // 等待 TTS 结束
        return;
      }
      console.log('AI message uploaded successfully:', res);
      clientPushMessageIndex(socket, res);

      // 在消息保存成功之后，再开始 TTS 结果的上传。
      if (msg.role === LLMRole.AI) {
        const audioData = await tts.waitFinish();
        if (++ai_string_reply_cnt > 1) {
          console.error('AI replies more than one string, this is unexpected.');
          return;
        }
        // save audio data to file.
        const audioFilePath = `./data/tts/demo_tts_${msgId.toString()}.ogg`;
        fs.promises.writeFile(audioFilePath, audioData).then(() => {
          console.log(`TTS audio saved to ${audioFilePath}`);
        }).catch((err) => {
          console.error(`Failed to save TTS audio to ${audioFilePath}:`, err);
        });
        const resp = await Api.uploadChatAudio(msgId, `${msgId}.ogg`, audioData)
        if (!resp.success) {
          console.error('Failed to upload AI audio:', resp.error);
          return;
        }
        console.log('AI audio uploaded successfully:', resp);
      }
    })().catch((err) => {
      console.error('Failed to upload AI message:', err);
    });
    return true;
  });

  try {
    // TODO: 防止 AI 单词过多，超过 2000 个字符。
    aiReply.text = await context.llmHelper.nextTextReply(sentence);
  } catch (err) {
    clientPushNotify(socket, 'AI 通信没能成功。');
    throw err;
  } finally {
    context.llmHelper.setAddMessageHook(undefined);
    context.llmHelper.setOnDeltaHook(undefined);
  }

  // 发送 LLM 的回答。
  if (aiReply.text !== null && aiReply.text.length > 0) {
    if (aiReply.messageId === null) {
      console.warn('AI reply messageId is null, generating a new one.');
      aiReply.messageId = generateSID();
    }
    clientPushAi(socket, aiReply.text, chatId, aiReply.messageId,);
  } else {
    clientPushNotify(socket, 'AI 没有给出回答。');
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
function clientPushNotify(socket: WebSocket, sentence: string) {
  console.log(`clientPushNotify: ${sentence}`);
  const response = {
    type: 'tts',
    state: 'sentence_start',
    text: sentence,
  };
  socket.send(JSON.stringify(response));
}

function clientPushAiDelta(
    socket: WebSocket, delta: string,
    chatId: bigint, aiMessageId: bigint, chunkIndex: number) {
  console.log(`clientPushAiDelta: ${delta}`);
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

function clientPushAi(
    socket: WebSocket, sentence: string,
    chatId: bigint, aiMessageId: bigint) {
  console.log(`clientPushAi: ${sentence}`);
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
  console.log('Sending audio with bosid:', bosid.toString(), ", size:", obj.size);
  const packetSize = 1800; // Example packet size
  obj.toBinaryPackets(packetSize).forEach(packet => {
    const buffer = packet.toBuffer();
    console.log(
      "Sending BinaryPacket with bosid:", packet.header.bosid.toString(),
      ", offset:", packet.header.offset,
      ", frame_size:", packet.header.frameSize);
    socket.send(buffer);
  });
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
function clientPushImage(socket: WebSocket, imageData: Buffer) {
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

type UploadUserMessageInput = {
  msgId: bigint;
  chatId: bigint;
  userId: bigint;
  audio: BinaryObject;
  sentence: string;
  socket: WebSocket;
};
// upload user message to server
function uploadUserMessage(input: UploadUserMessageInput) {
  (async () => {
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
    console.log('user message inserted successfully:', res);
    clientPushMessageIndex(input.socket, res);
    // 上传音频。
    // convert wav to ogg.
    const oggBuf = await input.audio.toOggBuffer();
    const resp = await Api.uploadChatAudio(input.msgId, `${input.msgId}.ogg`, oggBuf);
    if (!resp.success) {
      console.error('Failed to upload user audio:', resp.error);
      return;
    }
    console.log('user audio uploaded successfully:', resp);
  })().catch((err) => {
    console.error('Failed to upload user message:', err);
  });
}

class LLMTTS {
  private collector = new ChunkCollector();
  private tts = new TTSStreamVolcano();
  private reader = new OggStreamReader();
  private packetCache: OggPacket[] = [];
  private socket: WebSocket;
  private messageId: bigint = BigInt(0);
  private chatId: bigint = BigInt(0); // 当前聊天的 ID
  private chunkIndex: number = 0;
  // audio queue 是等待推送给客户端的音频数据。
  // 它是一个 OggPacket 数组，表示按每次的发送量合并后的音频数据包。
  // 因为客户端的音频队列长度有限，所以较长的音频数据需要分批发送。
  private audioQueue: Denque<OggPacket> = new Denque<OggPacket>();
  private queueTimer: NodeJS.Timeout | null = null;

  constructor(socket: WebSocket) {
    this.socket = socket;
    this.collector.setValues(5, 1000);
    this.collector.setChunkHook(this.onChunk.bind(this));
    // TODO: convert Buffer to Opus Audio Frame.
    // TODO: 响应 Client Abort Audio 的情况，中断推流，但是后台的保存还要继续。
    // TODO: TTS Stream Volcano 里面还有很多调节参数没有设置。
    this.tts.setOnDeltaHook(this.onTTSDelta.bind(this));
    this.reader.setOnPacketHook(this.onOggPacket.bind(this));
    this.tts.setOnSentenceHook((sentence: TTSSentence, begin: boolean) => {
      clientPushSentence(socket, sentence.text, begin);
    });
    this.tts.beginSession().then((sessId: string) => {
      console.log(`TTS session started with ID: ${sessId}`);
    }).catch((err) => {
      console.error('Failed to start TTS session:', err);
      clientPushNotify(socket, '语音合成初始化出错了，请稍后再试。');
    });
  }
  setMessageId(msgId: bigint, chatId: bigint) {
    this.messageId = msgId;
    this.chatId = chatId;
    this.chunkIndex = 0;
  }
  setSpeaker(speaker: string) { this.tts.setSpeaker(speaker); }
  addText(text: string | null) {
    this.collector.addText(text);
  }
  async waitFinish(): Promise<Buffer> {
    await this.tts.endSession();
    return await this.tts.waitFinish();
  }

  private onChunk(chunk: string, _trigger: ChunkCollector.Trigger) {
    console.log(`Received collected chunk: ${chunk}`);
    if (chunk.length > 0) {
      this.tts.addText(chunk);
      clientPushAiDelta(this.socket, chunk,
          this.chatId, this.messageId, this.chunkIndex++);
    }
  }
  private onTTSDelta(data: Buffer | null) {
    if (data === null) {
      console.log('TTS end of stream.');
      this.flushOggPacketCache();
      return;
    }
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
    console.log(`Flushing OggPacket with length ${merged.length} to client.`);
    // 推给客户端之前需要延时等到正确的时间点。
    this.pushQueue(merged);
  }

  private pushQueue(packet: OggPacket) {
    this.audioQueue.push(packet);
    if (this.queueTimer === null) {
      this.pushTTSStart();
      this.triggerSendAudio();
    }
  }

  // 函数的规则是如果队列有成员，那么推送一个包裹并且设置一个定时器，
  // 经过 96% 的播放时间之后再次触发这个函数。
  private triggerSendAudio() {
    if (this.audioQueue.length === 0) {
      console.log('Audio queue is empty, stopping timer.');
      this.clearTimer();
      this.pushTTSStopDelayed(1500);
      return;
    }
    // cannot be undefined, because we check length above.
    const packet: OggPacket = this.audioQueue.shift() as OggPacket;
    const audioTime = 60; // TODO: 计算音频包的播放时间
    this.resetTimer(audioTime * 0.96);
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
