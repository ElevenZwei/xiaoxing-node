import prisma from '../model/prisma';

enum SenderType {
  User = 0x4001,
  AI = 0x4002,
  Tool = 0x4003,
  System = 0x4004,
  Hidden = 0x4020,
};
enum MessageAuxType {
  ToolRequest = 0x4101,
  ToolResponse = 0x4102,
};

export async function getMessageById(messageId: bigint) {
  return prisma.chat_message.findUnique({
    where: { message_id: messageId },
  });
}

export type NewTextMessageInput = {
  messageId: bigint;
  chatId: bigint;
  senderType: number;
  senderId: bigint;
  content: string;
};
export async function insertTextMessage(input: NewTextMessageInput) {
  // TODO: insert or update the chat message
  return prisma.chat_message.create({
    data: {
      message_id: input.messageId,
      chat_id: input.chatId,
      sender_type: input.senderType,
      sender_id: input.senderId,
      message_type: 0x1, // 0x01 for text message
      text_content: input.content,
    },
  });
}

export type NewToolMessageInput = NewTextMessageInput;
export async function insertToolMessage(input: NewToolMessageInput) {
  return prisma.chat_message.create({
    data: {
      message_id: input.messageId,
      chat_id: input.chatId,
      sender_type: input.senderType,
      sender_id: input.senderId,
      message_type:
        input.senderType === SenderType.AI
        ? MessageAuxType.ToolRequest : MessageAuxType.ToolResponse,
      text_content: input.content,
      is_hidden_user: true,
      is_hidden_ai: false,
    },
  });
}

export type NewMediaMessageInput = {
  messageId: bigint,
  chatId: bigint,
  senderType: number,
  senderId: bigint,
  mediaType: number,
  mediaObjectId: bigint,
  mediaName: string | undefined,
};

export async function insertMediaMessage(input: NewMediaMessageInput) {
  return prisma.chat_message.create({
    data: {
      message_id: input.messageId,
      chat_id: input.chatId,
      sender_type: input.senderType,
      sender_id: input.senderId,
      message_type: input.mediaType,
      has_binary: true,
      binary_object_id: input.mediaObjectId,
      binary_object_name: input.mediaName || null, // Use null if mediaName is undefined or empty
      is_hidden_user: false,
      is_hidden_ai: true,
    },
  });
}

