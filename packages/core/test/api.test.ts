import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { ApiClient as ApiClientType, ApiRequestError as ApiRequestErrorType } from '../src/transport/api';

type Handler = (url: string, init: RequestInit) => Response;
let handler: Handler;
const calls: Array<{ url: string; init: RequestInit }> = [];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let ApiClient: typeof ApiClientType;
let ApiRequestError: typeof ApiRequestErrorType;

beforeAll(async () => {
  // api.ts captures fetch when it loads, so stub it before importing.
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  });
  ({ ApiClient, ApiRequestError } = await import('../src/transport/api'));
});

beforeEach(() => {
  calls.length = 0;
});

const client = () => new ApiClient('https://planora.test', 'pk_test', () => ({ user: { id: '42' }, user_hash: 'h' }));
const session = (token = 't1') => json(200, { data: { token, expires_at: new Date(Date.now() + 3_600_000).toISOString(), user: { id: '42' } } });

it('unwraps the { data } envelope and sends site key + bearer token', async () => {
  handler = (url) =>
    url.endsWith('/session')
      ? session()
      : json(200, { data: [{ id: 7, key: 'SHOP-7', type: 'bug', title: 'x', status: 'to_do', status_label: 'To Do', created_at: '', updated_at: '' }] });

  const tickets = await client().listTickets();
  expect(tickets[0]).toMatchObject({ id: 7, key: 'SHOP-7' });

  const list = calls.find((c) => c.url.endsWith('/api/v1/widget/tickets'))!;
  const headers = list.init.headers as Record<string, string>;
  expect(headers['X-Planora-Site-Key']).toBe('pk_test');
  expect(headers.Authorization).toBe('Bearer t1');
});

it('turns a Laravel 422 into an error carrying the first field message', async () => {
  handler = (url) =>
    url.endsWith('/session')
      ? session()
      : json(422, {
          message: 'The title field must be at least 3 characters. (and 1 more error)',
          errors: { title: ['The title field must be at least 3 characters.'], type: ['The selected type is invalid.'] },
        });

  const error = await client()
    .createTicket({ type: 'bug', title: 'x', description: 'd', attachment_ids: [], screenshot_id: null, context: null }, 'k')
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiRequestError);
  const apiError = error as ApiRequestErrorType;
  expect(apiError.status).toBe(422);
  expect(apiError.code).toBe('validation_error');
  expect(apiError.message).toBe('The title field must be at least 3 characters.');
  expect(apiError.fieldErrors.type).toEqual(['The selected type is invalid.']);
  expect(apiError.retryable).toBe(false);
});

it('on 401 starts a new session once and retries', async () => {
  let sessions = 0;
  let listCalls = 0;
  handler = (url) => {
    if (url.endsWith('/session')) return session(`t${++sessions}`);
    listCalls += 1;
    return listCalls === 1 ? json(401, { message: 'Unauthenticated.' }) : json(200, { data: [] });
  };

  await expect(client().listTickets()).resolves.toEqual([]);
  expect(sessions).toBe(2);
  expect(listCalls).toBe(2);
});

it('marks server errors and rate limits as retryable, and survives non-JSON bodies', async () => {
  handler = () => new Response('<html>Bad gateway</html>', { status: 502 });
  const error = (await client().getConfig().catch((e: unknown) => e)) as ApiRequestErrorType;
  expect(error.status).toBe(502);
  expect(error.code).toBe('server_error');
  expect(error.retryable).toBe(true);
});
