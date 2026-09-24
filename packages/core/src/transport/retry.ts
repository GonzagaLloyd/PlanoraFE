import { sleep } from '../util';
import { ApiRequestError } from './api';

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
}

export function isRetryable(error: unknown): boolean {
  return error instanceof ApiRequestError ? error.retryable : true;
}

/** Exponential backoff with jitter; only retries errors that can succeed later. */
export async function withRetry<T>(fn: () => Promise<T>, { attempts, baseDelayMs }: RetryOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts - 1) break;
      const delay = baseDelayMs * 2 ** attempt;
      await sleep(delay / 2 + Math.random() * (delay / 2));
    }
  }
  throw lastError;
}
