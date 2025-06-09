import { Request, Response } from 'express';
import * as UserService from '../service/userService';

export async function getUserById(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const user = await UserService.getUserById(id);
  if (user) {
    res.status(200).json(user);
  } else {
    res.status(404).json({ message: 'User not found' });
  }
};

export async function createUser(req: Request, res: Response): Promise<void> {

};

