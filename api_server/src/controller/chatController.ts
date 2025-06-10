import { Request, Response } from 'express';
import * as ChatService from '../service/chatService';

/* Handles the request to create a new chat for a user.
 * Input format:
    axios.get(`${API_URL}/chat/new`, {
      params: {
        user_id: userId.toString(),
        chat_id: chatId.toString(),
        prefix: prefix,
    }
 * Output format:
    {
      success: boolean;
      error?: string; // Optional message for errors or additional info
      chat_id: bigint;
      chat_name: string;
      last_message_index: number;
    }
 */
export async function userCreateChat(req: Request, res: Response): Promise<void> {
  if (typeof req.query.user_id !== 'string' || typeof req.query.chat_id !== 'string') {
    res.status(400).json({ success: false, error: 'Missing user_id or chat_id' });
    return;
  }
  const userId = BigInt(req.query.user_id);
  const chatId = BigInt(req.query.chat_id);
  const prefix = req.query.prefix ? String(req.query.prefix) : 'New Chat';
  if (userId <= 0n || chatId <= 0n) {
    res.status(400).json({ success: false, error: 'Invalid user_id or chat_id' });
    return;
  }
  try {
    const chat = await ChatService.userCreateChat(userId, chatId, prefix);
    const answer = {
      success: true,
      chat_id: chat.chat_id.toString(),
      chat_name: chat.chat_name,
      last_message_index: chat.last_message_index,
    };
    res.status(200).json(answer);
  } catch (error) {
    console.error('Error creating new chat:', error);
    res.status(500).json({ success: false, error: 'Failed to create new chat' });
  }
}

/* Handles the request to open an existing chat for a user.
 * Input format:
    axios.get(`${API_URL}/chat/open`, {
      params: {
        user_id: userId.toString(),
        chat_id: chatId.toString(),
    },
 * Output format:
    {
      success: boolean;
      error?: string; // Optional message for errors or additional info
      chat_id: bigint;
      chat_name: string;
      last_message_index: number;
    }
 */
export async function userOpenChat(req: Request, res: Response): Promise<void> {
  if (typeof req.query.user_id !== 'string' || typeof req.query.chat_id !== 'string') {
    res.status(400).json({ success: false, error: 'Missing user_id or chat_id' });
    return;
  }
  const userId = BigInt(req.query.user_id);
  const chatId = BigInt(req.query.chat_id);
  if (userId <= 0n || chatId <= 0n) {
    res.status(400).json({ success: false, error: 'Invalid user_id or chat_id' });
    return;
  }
  try {
    const chat = await ChatService.userOpenChat(userId, chatId);
    const answer = {
      success: true,
      chat_id: chat.chat_id.toString(),
      chat_name: chat.chat_name,
      last_message_index: chat.last_message_index,
    };
    res.status(200).json(answer);
  } catch (error) {
    console.error('Error opening existing chat:', error);
    res.status(500).json({ success: false, error: 'Failed to open existing chat' });
  }
}
