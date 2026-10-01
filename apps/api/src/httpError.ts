export function httpError(statusCode: number, code: string, message?: string): Error & { statusCode: number; code: string } {
  const err = new Error(message || code) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}
