import * as V from './env';
const db = {
  postgres: {
    local: {
      url: process.env.API_PG_URL || V.API_PG_URL || 'postgresql://user:password@localhost:5432/mydb',
    },
  },
};
console.log('Database configuration:', db);
export default db;

