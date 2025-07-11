// String utilities for client-server communication

import * as z from 'zod';
import { AxiosError } from 'axios';
import { APIError } from 'openai';


export function catchToString(error: unknown): string {
  if (error === null || error === undefined) {
    return 'Unknown error';
  }
  if (error instanceof AxiosError) {
    if (error.response) {
      return `AxiosError: ${error.message}, status: ${error.response.status}, data: ${JSON.stringify(error.response.data)}`;
    }
    return `AxiosError: ${error.message}`;
  }
  if (error instanceof APIError) {
    return `APIError: ${error.message}, code: ${error.code}, json: ${jsonStringify(error.error)}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function jsonStringify(data: any): string {
  // convert bigint to string
  return JSON.stringify(data, (_key, value) => 
    typeof value === 'bigint' ? value.toString() : value
  );
}

export const zBigIntString =
    z.string()
    .refine((val) => {
        try {
          BigInt(val);
          return true;
        } catch {
          return false;
        }
      }, 'Invalid bigint string')
    .transform(BigInt);

export const zSid =
    z.string()
    .refine((val) => {
        try {
          return BigInt(val) > 0n;
        } catch {
          return false;
        }
      }, 'Invalid snowflake id string')
    .transform(BigInt);

