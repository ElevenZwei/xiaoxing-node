import { PrismaClient } from '../../generated/prisma';
import db from '../config/db';

const pgUrl = db.postgres.local.url;
if (typeof pgUrl !== 'string' || !pgUrl.startsWith('postgresql://')) {
  throw new Error('Invalid PostgreSQL URL in configuration');
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: pgUrl,
    },
  },
});

export default prisma;
