import { Request, Response } from 'express';

function convertJsonBigIntToString(obj: any): any {
  if (typeof obj === 'bigint') {
    return obj.toString();
  } else if (Array.isArray(obj)) {
    return obj.map(convertJsonBigIntToString);
  } else if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(
        ([key, val]: any): any => [key, convertJsonBigIntToString(val)])
    );
  }
  return obj;
}

export function jsonBigIntMiddleware(_req: Request, res: Response, next: () => void): void {
  const originalJson = res.json;
  res.json = function (data) {
    const converted = convertJsonBigIntToString(data);
    return originalJson.call(this, converted);
  };
  next();
}

