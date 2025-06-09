import prisma from '../model/prisma';

export async function getChatById(chatId: bigint) {
  return prisma.chat_session.findUnique({
    where: { chat_id: chatId },
  });
}

export async function getActiveChatsWithUser(userId: bigint) {
  return prisma.chat_session.findMany({
    where: { user_id: userId, is_active: true },
    orderBy: { created_at: 'desc' },
  });
}

export async function getChatsByName(userId: bigint, chatName: string) {
  return prisma.chat_session.findMany({
    where: {
      user_id: userId,
      chat_name: chatName,
      is_active: true,
    },
  });
}

export async function insertChatSession(chatId: bigint, userId: bigint, chatName: string) {
  return prisma.chat_session.create({
    data: {
      chat_id: chatId,
      user_id: userId,
      chat_name: chatName,
    },
  });
}

export async function renameChatSession(chatId: bigint, chatName: string) {
  return prisma.chat_session.update({
    where: { chat_id: chatId },
    data: { chat_name: chatName },
  });
}

export async function removeChatSession(chatId: bigint) {
  return prisma.chat_session.update({
    where: { chat_id: chatId },
    data: { is_active: false, removed_at: new Date() },
  });
}

export async function userCreateChat(chatId: bigint, userId: bigint, prefix: string) {
  // select all chat names of user of prefix
  const existingChats = await prisma.chat_session.findMany({
    select: { chat_name: true },
    where: {
      user_id: userId,
      chat_name: { startsWith: prefix, },
      is_active: true,
    },
  });
  // convert to a set to check for uniqueness
  const existingChatNames = new Set(existingChats.map(chat => chat.chat_name));
  // make sure the chat name is unique
  let index = 1;
  while (existingChatNames.has(prefix + index.toString())) {
    index++;
  }
  const chatName = prefix + index.toString();
  return prisma.chat_session.create({
    data: {
      chat_id: chatId,
      user_id: userId,
      chat_name: chatName,
    },
  });
}

export async function userCanReadChat(userId: bigint, chatId: bigint) {
  const chat = await prisma.chat_session.findUnique({
    where: { chat_id: chatId },
    select: { user_id: true },
  });
  const isOwner = chat?.user_id === userId;
  if (isOwner) { return true; }
  // check if the user has an active share for the chat
  const chatShare = await prisma.chat_share.findFirst({
    select: { chat_id: true },
    where: {
      chat_id: chatId,
      shared_user_id: userId,
      is_active: true,
    },
  });
  return chatShare !== null;
}

export async function getChatLastMessageIndex(chatId: bigint) {
  const message = await prisma.chat_message.findFirst({
    where: { chat_id: chatId },
    select: { message_index: true, },
    orderBy: { message_index: 'desc' },
  }) || { message_index: 0 };
  return message.message_index;
}

export async function userOpenChat(user_id: bigint, chat_id: bigint) {
  if (!(await userCanReadChat(user_id, chat_id))) {
    throw new Error('User does not have permission to read this chat');
  }
  const chat = await getChatById(chat_id);
  if (!chat) {
    throw new Error('Chat not found');
  }
  const lastMessageIndex = await getChatLastMessageIndex(chat_id);
  return {
    chat_id: chat.chat_id,
    user_id: chat.user_id,
    chat_name: chat.chat_name,
    created_at: chat.created_at,
    last_message_index: lastMessageIndex,
  };
}


