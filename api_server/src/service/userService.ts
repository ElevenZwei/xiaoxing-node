import prisma from '../model/prisma';

export async function getUserById(userId: bigint) {
  return prisma.user_info.findUnique({
    where: { user_id: userId },
  });
};

