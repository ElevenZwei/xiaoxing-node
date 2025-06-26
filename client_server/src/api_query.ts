import axios from 'axios';
import { AxiosError } from 'axios';
import { FormData, Blob } from 'formdata-node';
import { FormDataEncoder } from 'form-data-encoder';
import { Readable } from 'stream';
import { BOType } from './binary_packet';

const API_URL = 'http://localhost:6810'; // Example API URL for creating new chat

// TODO: All api responses should be checked with zod schemas for validation.

export type UserOpenChatResponse = {
  success: boolean;
  error?: string; // Optional message for errors or additional info
  chat_id: bigint;
  chat_name: string;
  last_message_index: number;
};

export async function userNewChat(
    userId: bigint, chatId: bigint, prefix: string = 'New Chat'): Promise<UserOpenChatResponse> {
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

export async function userOpenExChat(userId: bigint, chatId: bigint):
  Promise<UserOpenChatResponse> {
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

export type UploadChatAudioInput = {
  objectId: bigint;
  saveName: string;
  description?: string; // Optional description of the audio file
  content: Buffer; // Audio content as a Buffer
};
export type UploadBinaryObjectInput = UploadChatAudioInput & {
  fileType: number; // File type (e.g., image, audio, video)
  name?: string; // A descriptive name of this binary file.jjj
};
type UploadBinaryObjectImplInput = UploadBinaryObjectInput & {
  urlPart: 'object' | 'audio'; // Part of the URL to use for the upload
};
export type BinaryObjectUploadResponse = {
  success: boolean;
  error?: string; // Optional error message
  object_id: bigint;
};
export async function uploadBinaryObject(input: UploadBinaryObjectInput):
  Promise<BinaryObjectUploadResponse> {
  return uploadBinaryObjectImpl({
    urlPart: 'object',
    ...input,
  });
};
export async function uploadChatAudio(input: UploadChatAudioInput):
  Promise<BinaryObjectUploadResponse> {
  return uploadBinaryObjectImpl({
    urlPart: 'audio',
    fileType: BOType.AudioOpus,
    ...input,
  });
}
async function uploadBinaryObjectImpl(input: UploadBinaryObjectImplInput):
  Promise<BinaryObjectUploadResponse> {
  const { objectId, saveName, name, description, content, fileType, urlPart } = input;
  console.log(`Uploading binary object with ID ${objectId}, type ${fileType}`
              + `, size ${content.length}, name "${saveName}"`);
  // This function should upload a BinaryObject to the server
  // For now, we return a placeholder
  // return {
  //   success: true,
  //   object_id: objectId,
  // };
  const form = new FormData();
  form.set('object_id', objectId.toString());
  form.set('file_type', fileType.toString());
  form.set('file_size', content.length.toString());
  if (description != null && description.length > 0) {
    form.append('description', description);
  }
  if (name != null && name.length > 0) {
    form.append('name', name);
  }
  form.set('content', new Blob([content], { type: 'application/octet-stream' }), saveName);
  const encoder = new FormDataEncoder(form);
  return axios.post(`${API_URL}/binary/${urlPart}`, Readable.from(encoder.encode()), {
      headers: encoder.headers,
  }).then(response => response.data).catch((error: AxiosError) => {
    console.error('Error uploading BinaryObject:', error.message);
    const data = error.response?.data as (BinaryObjectUploadResponse | undefined);
    if (data != null && data.success === false) {
      return data;
    }
    throw error;
  });
}

export type BinaryObjectDownloadResponse = {
  success: true,
  data: Buffer
} | {
  success: false;
  error: string; // Optional error message
};

export async function downloadBinaryObject(objectId: bigint): Promise<BinaryObjectDownloadResponse> {
  console.log(`Retrieving binary object with ID ${objectId}`);
  // return { success: true, data: Buffer.from([]) }; // Placeholder for actual download logic
  return axios.get(`${API_URL}/binary/object`, {
    params: {
      object_id: objectId.toString(),
    },
    responseType: 'arraybuffer', // Ensure we get the binary data
  }).then(response => {
    return { success: true, data: Buffer.from(response.data) } as { success: true, data: Buffer };
  }).catch((error: AxiosError) => {
    console.error('Error retrieving BinaryObject:', error.message);
    return { success: false, error: error.message, };
  });
}

export type BinaryObjectInfoResponse = {
  success: boolean;
  error?: string;       // Optional error message
  object_id: bigint;    // BinaryObject ID
  file_type: number;    // File type (e.g., image, audio, video)
  file_size: number;    // Size of the file in bytes
  name?: string; // Optional name of the object
  description?: string; // Optional description of the object
}
export async function fetchBinaryObjectInfo(objectId: bigint): Promise<BinaryObjectInfoResponse> {
  console.log(`Fetching info for binary object with ID ${objectId}`);
  return axios.get(`${API_URL}/binary/info`, {
    params: {
      object_id: objectId.toString(),
    },
  }).then(response => response.data).catch((error: AxiosError) => {
    console.error('Error fetching BinaryObject info:', error.message);
    const data = error.response?.data as (BinaryObjectInfoResponse | undefined);
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
};
export type NewMessageResponse = {
  success: boolean;
  error?: string; // Optional error message
  chat_id: bigint;
  message_id: bigint;
  message_index: number;
};
export async function newTextMessage(input: NewTextMessageInput):
  Promise<NewMessageResponse> {
  console.log(`Creating new text message with ID ${input.messageId}, chat ID ${input.chatId}, sender type ${input.senderType}, sender ID ${input.senderId}, content "${input.content}"`);
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
  }).then(response => response.data).catch((error: AxiosError) => {
    console.error('Error creating new text message:', error.message);
    const data = error.response?.data as (NewMessageResponse | undefined);
    if (data != null && data.success === false) {
      return data;
    }
    throw error;
  });
}

export type NewMediaMessageInput = {
  messageId: bigint;
  chatId: bigint;
  senderType: number;
  senderId: bigint;
  mediaType: number; // e.g., image, audio, video
  mediaObjectId: bigint; // ID of the uploaded media object
  mediaName?: string; // Name of the media file
};
export async function newMediaMessage(input: NewMediaMessageInput):
  Promise<NewMessageResponse> {
  console.log(`Creating new media message with ID ${input.messageId}, chat ID ${input.chatId}, sender type ${input.senderType}, sender ID ${input.senderId}, media type ${input.mediaType}, media object ID ${input.mediaObjectId}, media name "${input.mediaName}"`);
  return axios.post(`${API_URL}/message/new/media`, {
    msg_id: input.messageId.toString(),
    chat_id: input.chatId.toString(),
    sender_type: input.senderType,
    sender_id: input.senderId.toString(),
    media_type: input.mediaType,
    media_object_id: input.mediaObjectId.toString(),
    media_name: input.mediaName,
  }).then(response => response.data).catch((error: AxiosError) => {
    console.error('Error creating new media message:', error.message);
    const data = error.response?.data as (NewMessageResponse | undefined);
    if (data != null && data.success === false) {
      return data;
    }
    throw error;
  });
}

export type NewToolMessageInput = NewTextMessageInput;
export async function newToolMessage(input: NewToolMessageInput):
  Promise<NewMessageResponse> {
  console.log(`Creating new tool message with ID ${input.messageId}, chat ID ${input.chatId}, sender type ${input.senderType}, sender ID ${input.senderId}, content "${input.content}"`);
  return axios.post(`${API_URL}/message/new/tool`, {
    msg_id: input.messageId.toString(),
    chat_id: input.chatId.toString(),
    sender_type: input.senderType,
    sender_id: input.senderId.toString(),
    content: input.content,
  }).then(response => response.data).catch((error: AxiosError) => {
    console.error('Error creating new tool message:', error.message);
    const data = error.response?.data as (NewMessageResponse | undefined);
    if (data != null && data.success === false) {
      return data;
    }
    throw error;
  });
}



