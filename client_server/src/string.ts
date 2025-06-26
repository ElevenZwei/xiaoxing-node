// String utilities for client-server communication

export function jsonStringify(data: any): string {
  // convert bigint to string
  return JSON.stringify(data, (_key, value) => {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  });
}

