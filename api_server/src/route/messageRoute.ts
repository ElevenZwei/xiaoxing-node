import { Router } from 'express';
import { newTextMessage } from '../controller/messageController';

const router = Router();

router.post('/new/text', newTextMessage);

export default router;
