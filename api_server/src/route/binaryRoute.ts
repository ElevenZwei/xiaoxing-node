import { Router } from "express";
import multer from 'multer';
import {
    uploadBinaryObject, uploadChatAudio,
    downloadBinaryObject
} from '../controller/binaryController';

const upload = multer({ storage: multer.memoryStorage() });

const router = Router();
router.post('/object', upload.single('content'), uploadBinaryObject);
router.post('/audio', upload.single('content'), uploadChatAudio);
router.get('/object', downloadBinaryObject);

export default router;

