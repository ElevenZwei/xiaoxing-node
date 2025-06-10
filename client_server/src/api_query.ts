import axios from 'axios';
import { AxiosError } from 'axios';
import FormData from 'form-data';

const API_URL = 'http://localhost:6810'; // Example API URL for creating new chat

export type UserOpenChatResponse = {
  success: boolean;
  error?: string; // Optional message for errors or additional info
  chat_id: bigint;
  chat_name: string;
  last_message_index: number;
};

export async function userNewChat(
    userId: bigint, chatId: bigint, prefix: string = 'New Chat')
: Promise<UserOpenChatResponse> {
  console.log(`Creating new chat for user ${userId} with chat ID ${chatId} and prefix "${prefix}"`);
  // This function should create a new chat session for the user
  // For now, we return a placeholder
  // return {
  //   success: true,
  //   chat_id: chatId,
  //   chat_name: 'Placeholder Chat',
  //   last_message_index: 0,
  // };
  return axios.get(`${API_URL}/chat/new`, {
    params: {
      user_id: userId.toString(),
      chat_id: chatId.toString(),
      prefix: prefix,
    },
  }).then(response => response.data).catch((error: AxiosError) => {
    console.error('Error creating new chat:', error.message);
    const data = error.response?.data as (UserOpenChatResponse | undefined);
    if (data != null && data.success === false) {
      return data;
    }
    throw error;
  });
}

export async function userOpenExChat(userId: bigint, chatId: bigint)
: Promise<UserOpenChatResponse> {
  console.log(`Opening existing chat for user ${userId} with chat ID ${chatId}`);
  // This function should retrieve the user's open chat session.
  // For now, we return a placeholder
  // return {
  //   success: true,
  //   chat_id: chatId,
  //   chat_name: 'Placeholder Chat',
  //   last_message_index: 0,
  // };
  return axios.get(`${API_URL}/chat/open`, {
    params: {
      user_id: userId.toString(),
      chat_id: chatId.toString(),
    },
  }).then(response => response.data).catch((error: AxiosError) => {
    console.error('Error opening existing chat:', error.message);
    const data = error.response?.data as (UserOpenChatResponse | undefined);
    if (data != null && data.success === false) {
      return data;
    }
    throw error;
  });
}

export type BinaryObjectUploadResponse = {
  success: boolean;
  object_id: bigint;
};
export async function uploadBinaryObject(
    objectId: bigint, fileType: number, fileSize: bigint,
    saveName: string, content: Buffer)
: Promise<BinaryObjectUploadResponse> {
  console.log(`Uploading binary object with ID ${objectId}, type ${fileType}, size ${fileSize}, name "${saveName}"`);
  // This function should upload a BinaryObject to the server
  // For now, we return a placeholder
  // return {
  //   success: true,
  //   object_id: objectId,
  // };
  const form = new FormData();
  form.append('object_id', objectId.toString());
  form.append('file_type', fileType.toString());
  form.append('file_size', fileSize.toString());
  form.append('content', content, {
    filename: saveName,
    contentType: 'application/octet-stream',
  });
  return axios.post(`${API_URL}/binary/upload`, form, {
      headers: {
        ...form.getHeaders(),
      },
  }).then(response => response.data).catch((error: AxiosError) => {
    console.error('Error uploading BinaryObject:', error.message);
    const data = error.response?.data as (BinaryObjectUploadResponse | undefined);
    if (data != null && data.success === false) {
      return data;
    }
    throw error;
  });
}

export type NewTextMessageInput = {
  messageId: bigint;
  chatId: bigint;
  senderType: number;
  senderId: bigint;
  content: string;
  withAudio: boolean;
};
export type NewMessageResponse = {
  success: boolean;
  error?: string; // Optional error message
  chat_id: bigint;
  message_id: bigint;
  message_index: number;
};
export async function newTextMessage(input: NewTextMessageInput)
: Promise<NewMessageResponse> {
  console.log(`Creating new text message with ID ${input.messageId}, chat ID ${input.chatId}, sender type ${input.senderType}, sender ID ${input.senderId}, content "${input.content}", with audio: ${input.withAudio}`);
  // This function should create a new text message in the chat
  // For now, we return a placeholder
  // return {
  //   success: true,
  //   chat_id: chatId,
  //   message_id: msgId,
  //   message_index: 1,
  // };
  return axios.post(`${API_URL}/message/new/text`, {
    msg_id: input.messageId.toString(),
    chat_id: input.chatId.toString(),
    sender_type: input.senderType,
    sender_id: input.senderId.toString(),
    content: input.content,
    with_audio: input.withAudio,
  }).then(response => response.data).catch((error: AxiosError) => {
    console.error('Error creating new text message:', error.message);
    const data = error.response?.data as (NewMessageResponse | undefined);
    if (data != null && data.success === false) {
      return data;
    }
    throw error;
  });
}

