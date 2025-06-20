import { Request, Response } from 'express';
import * as BinaryService from '../service/binaryService';
import { UploadArgs } from '../service/binaryService';

/** Handles the request to upload a binary object.
  * Output format: { success: boolean; error?: string; object_id: bigint }
  */
export async function uploadBinaryObject(req: Request, res: Response): Promise<void> {
  const args = parseUploadArgs(req);
  if (!args) {
    res.status(400).json({ success: false, error: 'Invalid upload arguments' });
    return;
  }
  try {
    const line = await BinaryService.uploadBinaryObject(args);
    const answer = {
      success: true,
      object_id: line.object_id.toString(),
    };
    res.status(200).json(answer);
  } catch (error) {
    console.error('Error uploading binary object:', error);
    res.status(500).json({ success: false, error: 'Failed to upload binary object' });
  }
}


/** Handles the request to upload a chat audio file.
  * Output format: { success: boolean; error?: string; object_id: bigint }
  */
export async function uploadChatAudio(req: Request, res: Response): Promise<void> {
  const args = parseUploadArgs(req);
  if (!args) {
    res.status(400).json({ success: false, error: 'Invalid upload arguments' });
    return;
  }
  try {
    const line = await BinaryService.uploadChatAudio(args);
    const answer = {
      success: true,
      object_id: line.object_id.toString(),
    };
    res.status(200).json(answer);
  } catch (error) {
    console.error('Error uploading chat audio:', error);
    res.status(500).json({ success: false, error: 'Failed to upload chat audio' });
  }
}

/** Handles the request to fetch binary object info.
  * Input format:
    axios.get(`${API_URL}/binary/info`, {
      params: {
        object_id: objectId.toString(),
      },
    })
  * Output format:
    { success: boolean; error?: string; object_id: bigint; file_type: number; file_size: bigint; }
  */
export async function fetchBinaryObjectInfo(req: Request, res: Response): Promise<void> {
  if (typeof req.query.object_id !== 'string') {
    res.status(400).json({ success: false, error: 'Invalid object ID format' });
    return;
  }
  const objectId = BigInt(req.query.object_id);
  if (objectId <= 0n) {
    res.status(400).json({ success: false, error: 'Invalid object ID' });
    return;
  }
  try {
    const bo = await BinaryService.getBinaryObjectInfoById(objectId);
    if (!bo) {
      res.status(404).json({ success: false, error: 'Object not found' });
      return;
    }
    const answer = {
      success: true,
      object_id: bo.object_id.toString(),
      file_type: bo.file_type,
      file_size: bo.file_size.toString(),
    };
    res.status(200).json(answer);
  } catch (error) {
    console.error('Error fetching binary object info:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch binary object info' });
  }
}


// 工具函数：RFC 5987 编码
function encodeRFC5987ValueChars(str: string): string {
  return encodeURIComponent(str)
  .replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16))
  .replace(/%(7C|60|5E)/g, match => match.toLowerCase());
}

/** Handles the request to download a binary object.
  * Input format: 
    axios.get(`${API_URL}/binary/object`, {
      params: {
        object_id: objectId.toString(),
      },
      responseType: 'arraybuffer', // Ensure we get the binary data
    }).then(response => Buffer.from(response.data))
  * Output format: The binary content of the object.
  */
export async function downloadBinaryObject(req: Request, res: Response): Promise<void> {
  if (typeof req.query.object_id !== 'string') {
    res.status(400).json({ success: false, error: 'Invalid object ID format' });
    return;
  }
  const objectId = BigInt(req.query.object_id);
  if (objectId <= 0n) {
    res.status(400).json({ success: false, error: 'Invalid object ID' });
    return;
  }
  try {
    const bo: BinaryService.BinaryOutput = await BinaryService.readBinaryObject(objectId);
    if (!bo) {
      res.status(404).json({ success: false, error: 'Object not found' });
      return;
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    const fallbackName = 'sample' + '.' + (bo.saveName.split('.').pop() || 'bin');
    res.setHeader('Content-Disposition', `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeRFC5987ValueChars(bo.saveName)}`);
    res.setHeader('Content-Length', bo.content.length.toString());
    res.setHeader('X-Object-ID', bo.objectId.toString());
    res.status(200).send(bo.content);
  } catch (error) {
    console.error('Error downloading binary object:', error);
    res.status(500).json({ success: false, error: 'Failed to download binary object' });
  }
}

/** Parse args from the request to upload a binary object.
  * Input format:
  * const form = new FormData();
    form.append('object_id', objectId.toString());
    form.append('file_type', fileType.toString());
    form.append('file_size', content.length.toString());
    form.append('content', content, {
      filename: saveName,
      contentType: 'application/octet-stream',
    });
    return axios.post(`${API_URL}/binary/${urlPart}`, form, {
      headers: {
        ...form.getHeaders(),
      },
    });
  * Output format: UploadArgs
  */
function parseUploadArgs(req: Request): UploadArgs | null {
  if (!req.body || !req.file) {
    return null;
  }
  const objectId = BigInt(req.body.object_id);
  const fileType = Number(req.body.file_type);
  const fileSize = BigInt(req.body.file_size);
  const saveName = req.file.originalname;
  const content = req.file.buffer;
  if (objectId <= 0n || fileType < 0 || fileSize <= 0 || !saveName || !content) {
    return null;
  }
  return {
    objectId,
    fileType,
    fileSize,
    saveName,
    content };
}


