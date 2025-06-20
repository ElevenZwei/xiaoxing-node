import { Request, Response } from 'express';
import { z } from 'zod';

import * as MessageService from '../service/messageService';
import prisma from '../model/prisma';

type MessageLine = Awaited<ReturnType<typeof prisma.chat_message.create>>;

type MessageResponse = {
  success: boolean;
  error?: string; // Optional error message
  chat_id: bigint;
  message_id: bigint;
  message_index: number;
};

function answer(line: MessageLine): MessageResponse {
  const answer = {
    success: true,
    chat_id: line.chat_id,
    message_id: line.message_id,
    message_index: line.message_index!,  // cannot be null in database constraint.
  };
  return answer;
}

/* Handles the request to create a new text message in a chat.
 * Input format:
    axios.post(`${API_URL}/message/new/text`, {
      msg_id: input.messageId.toString(),
      chat_id: input.chatId.toString(),
      sender_type: input.senderType,
      sender_id: input.senderId.toString(),
      content: input.content,
    })
 * Output format:
    {
      success: boolean;
      error?: string; // Optional error message
      chat_id: bigint;
      message_id: bigint;
      message_index: number;
    }
 */
export async function newTextMessage(req: Request, res: Response): Promise<void> {
  try {
    const input = parseTextMessage(req, res);
    if (input === undefined) {
      // Error response already sent in parseTextMessage
      return;
    }
    const line = await MessageService.insertTextMessage(input);
    if (!line) {
      res.status(500).json({ success: false, error: 'Failed to create new text message' });
      return;
    }
    res.status(200).json(answer(line));
  } catch (error) {
    console.error('Error creating new text message:', error);
    res.status(500).json({ success: false, error: 'Failed to create new text message' });
  }
}

/** Handles the request to create a new tool message in a chat.
  * Input format and output format are similar to newTextMessage,
  * except that the content is a JSON string.
  */
export async function newToolMessage(req: Request, res: Response): Promise<void> {
  try {
    const input = parseTextMessage(req, res);
    if (input === undefined) {
      // Error response already sent in parseTextMessage
      return;
    }
    const line = await MessageService.insertToolMessage(input);
    if (!line) {
      res.status(500).json({ success: false, error: 'Failed to create new tool message' });
      return;
    }
    res.status(200).json(answer(line));
  } catch (error) {
    console.error('Error creating new tool message:', error);
    res.status(500).json({ success: false, error: 'Failed to create new tool message' });
  }
}

/** Handles the request to create a new media message in a chat.
  */
export async function newMediaMessage(req: Request, res: Response): Promise<void> {
  try {
    const input = parseMediaMessage(req, res);
    if (input === undefined) {
      // Error response already sent in parseMediaMessage
      return;
    }
    const line = await MessageService.insertMediaMessage(input);
    if (!line) {
      res.status(500).json({ success: false, error: 'Failed to create new media message' });
      return;
    }
    res.status(200).json(answer(line));
  } catch (error) {
    console.error('Error creating new media message:', error);
    res.status(500).json({ success: false, error: 'Failed to create new media message' });
  }
}


const TextMessageSchema = z.object({
  msg_id: z.string().refine((val) => {
    try {
      return BigInt(val) > 0n;
    } catch {
      return false;
    }
  }, { message: 'Invalid msg_id' }),
  chat_id: z.string().refine((val) => {
    try {
      return BigInt(val) > 0n;
    } catch {
      return false;
    }
  }, { message: 'Invalid chat_id' }),
  sender_type: z.number(),
  sender_id: z.string().refine((val) => {
    try {
      return BigInt(val) > 0n;
    } catch {
      return false;
    }
  }, { message: 'Invalid sender_id' }),
  content: z.string().min(1, 'Content cannot be empty').max(10000, 'Content too long'),
});

function parseTextMessage(req: Request, res: Response): MessageService.NewTextMessageInput | undefined {
  const result = TextMessageSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ success: false, error: result.error.errors.map(e => e.message).join(', ') });
    return;
  }
  const { msg_id, chat_id, sender_type, sender_id, content } = result.data;
  return {
    messageId: BigInt(msg_id),
    chatId: BigInt(chat_id),
    senderType: sender_type,
    senderId: BigInt(sender_id),
    content,
  };
}

const MediaMessageSchema = z.object({
  msg_id: z.string().refine((val) => {
    try {
      return BigInt(val) > 0n;
    } catch {
      return false;
    }
  }, { message: 'Invalid msg_id' }),
  chat_id: z.string().refine((val) => {
    try {
      return BigInt(val) > 0n;
    } catch {
      return false;
    }
  }, { message: 'Invalid chat_id' }),
  sender_type: z.number(),
  sender_id: z.string().refine((val) => {
    try {
      return BigInt(val) > 0n;
    } catch {
      return false;
    }
  }, { message: 'Invalid sender_id' }),
  media_type: z.number(),
  media_object_id: z.string().refine((val) => {
    try {
      return BigInt(val) > 0n;
    } catch {
      return false;
    }
  }, { message: 'Invalid media_object_id' }),
  media_name: z.string().min(1, 'Media name cannot be empty').max(100, 'Media name too long').optional(),
});

function parseMediaMessage(req: Request, res: Response): MessageService.NewMediaMessageInput | undefined {
  const result = MediaMessageSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ success: false, error: result.error.errors.map(e => e.message).join(', ') });
    return;
  }
  const { msg_id, chat_id, sender_type, sender_id, media_type, media_object_id, media_name } = result.data;
  return {
    messageId: BigInt(msg_id),
    chatId: BigInt(chat_id),
    senderType: sender_type,
    senderId: BigInt(sender_id),
    mediaType: media_type,
    mediaObjectId: BigInt(media_object_id),
    mediaName: media_name || undefined,
  };
}

