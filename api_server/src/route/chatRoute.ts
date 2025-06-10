import { Router } from "express";
import { userOpenChat, userCreateChat } from "../controller/chatController";

const router = Router();
router.get('/open', userOpenChat);
router.get('/new', userCreateChat);

export default router;

