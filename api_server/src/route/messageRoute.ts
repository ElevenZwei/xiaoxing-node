import { Router } from 'express';
import {
  newTextMessage, newToolMessage, newMediaMessage
} from '../controller/messageController';

const router = Router();

router.post('/new/text', newTextMessage);
router.post('/new/tool', newToolMessage);
router.post('/new/media', newMediaMessage);

export default router;
