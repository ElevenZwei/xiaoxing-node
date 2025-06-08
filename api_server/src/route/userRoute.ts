import { Router } from 'express';
import { getUserById, createUser } from '../controller/userController';

const router = Router();
router.get('/:id', getUserById);
router.post('/', createUser);

export default router;
