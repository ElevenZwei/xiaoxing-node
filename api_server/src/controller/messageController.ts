import { Request, Response } from 'express';
import * as MessageService from '../service/messageService';

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
  if (req.body == null) {
    res.status(400).json({ success: false, error: 'Missing request body' });
    return;
  }
  if (typeof req.body.msg_id !== 'string' ||
      typeof req.body.chat_id !== 'string' ||
      typeof req.body.sender_type !== 'number' ||
      typeof req.body.sender_id !== 'string' ||
      typeof req.body.content !== 'string') {
    res.status(400).json({ success: false, error: 'Invalid input data' });
    return;
  }
  const input = {
    messageId: BigInt(req.body.msg_id),
    chatId: BigInt(req.body.chat_id),
    senderType: req.body.sender_type,
    senderId: BigInt(req.body.sender_id),
    content: req.body.content,
  };
  if (input.content.length === 0) {
    res.status(400).json({ success: false, error: 'Content cannot be empty' });
    return;
  }
  if (input.content.length > 10000) {
    res.status(400).json({ success: false, error: 'Content too long' });
    return;
  }
  if (input.messageId <= 0n || input.chatId <= 0n || input.senderId <= 0n) {
    res.status(400).json({ success: false, error: 'Invalid IDs' });
    return;
  }
  try {
    const line = await MessageService.insertTextMessage(input);
    if (!line) {
      res.status(500).json({ success: false, error: 'Failed to create new text message' });
      return;
    }
    const answer = {
      success: true,
      chat_id: line.chat_id.toString(),
      message_id: line.message_id.toString(),
      message_index: line.message_index,
    };
    res.status(200).json(answer);
  } catch (error) {
    console.error('Error creating new text message:', error);
    res.status(500).json({ success: false, error: 'Failed to create new text message' });
  }
}

