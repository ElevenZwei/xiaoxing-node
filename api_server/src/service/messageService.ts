import prisma from '../model/prisma';

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

export async function insertMediaMessage(
  messageId: bigint,
  chatId: bigint,
  senderType: number,
  senderId: bigint,
  mediaType: number,
  mediaObjectId: bigint,
  mediaName: string | undefined,
) {
  return prisma.chat_message.create({
    data: {
      message_id: messageId,
      chat_id: chatId,
      sender_type: senderType,
      sender_id: senderId,
      message_type: mediaType,
      has_binary: true,
      binary_object_id: mediaObjectId,
      binary_object_name: mediaName || null, // Use null if mediaName is undefined
      is_hidden_user: false,
      is_hidden_ai: true,
    },
  });
}

export async function insertToolMessage(
  messageId: bigint,
  chatId: bigint,
  senderType: number,
  senderId: bigint,
  content: string,
) {
  return prisma.chat_message.create({
    data: {
      message_id: messageId,
      chat_id: chatId,
      sender_type: senderType,
      sender_id: senderId,
      message_type: 0x2, // 0x02 for json message
      text_content: content,
      is_hidden_user: true,
      is_hidden_ai: false,
    },
  });
}


