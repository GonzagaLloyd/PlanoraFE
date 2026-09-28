/**
 * Executable spec for /api/v1/widget. No browser: plain HTTP requests.
 *
 * Runs against the mock API by default. Point it at a Planora instance to use
 * it as the acceptance test for the Laravel implementation:
 *
 *   WIDGET_API_BASE=http://localhost:8000 \
 *   WIDGET_SITE_KEY=pk_… WIDGET_SITE_SECRET=sk_… \
 *   npx playwright test api-contract
 *
 * The site must be in team mode with user-hash verification switched on.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';

const BASE = process.env.WIDGET_API_BASE ?? 'http://localhost:8787';
const SITE_KEY = process.env.WIDGET_SITE_KEY ?? 'pk_test_secure';
const SITE_SECRET = process.env.WIDGET_SITE_SECRET ?? 'sk_test_secure';
const PREFIX = `${BASE}/api/v1/widget`;
const ORIGIN = 'http://localhost:5173';
const USING_MOCK = !process.env.WIDGET_API_BASE;

const siteHeaders = { 'X-Planora-Site-Key': SITE_KEY, Accept: 'application/json', Origin: ORIGIN };
const hashFor = (id: string) => createHmac('sha256', SITE_SECRET).update(id).digest('hex');

async function session(request: APIRequestContext, userId = `contract-${randomUUID()}`) {
  const res = await request.post(`${PREFIX}/session`, {
    headers: siteHeaders,
    data: { user: { id: userId, name: 'Contract Test' }, user_hash: hashFor(userId) },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  return { token: body.data.token as string, userId };
}

const auth = (token: string) => ({ ...siteHeaders, Authorization: `Bearer ${token}` });

const ticketBody = (title = 'Checkout button does nothing') => ({
  type: 'bug',
  title,
  description: 'Clicking Place order does nothing.',
  attachment_ids: [],
  screenshot_id: null,
  context: null,
});

test.describe('widget API contract', () => {
  test.beforeAll(async ({ request }) => {
    if (USING_MOCK) await request.post(`${BASE}/__ops/reset`);
  });

  test('GET config: needs only the site key, wrapped in data', async ({ request }) => {
    const res = await request.get(`${PREFIX}/config`, { headers: siteHeaders });
    expect(res.status()).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ enabled: expect.any(Boolean), mode: expect.stringMatching(/^(team|public)$/) });
    expect(data.branding).toMatchObject({ primary_color: expect.any(String), position: expect.any(String) });
  });

  test('unknown site key: 401 with a Laravel error body', async ({ request }) => {
    const res = await request.get(`${PREFIX}/config`, { headers: { ...siteHeaders, 'X-Planora-Site-Key': 'pk_nope' } });
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ message: expect.any(String) });
  });

  test('POST session: a valid user hash returns a token', async ({ request }) => {
    const userId = `contract-${randomUUID()}`;
    const res = await request.post(`${PREFIX}/session`, {
      headers: siteHeaders,
      data: { user: { id: userId, name: 'Ana' }, user_hash: hashFor(userId) },
    });
    expect(res.status()).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ token: expect.any(String), expires_at: expect.any(String), user: { id: userId } });
  });

  test('POST session: a forged hash is refused with 401', async ({ request }) => {
    const res = await request.post(`${PREFIX}/session`, {
      headers: siteHeaders,
      data: { user: { id: 'someone-else' }, user_hash: 'forged' },
    });
    expect(res.status()).toBe(401);
    expect((await res.json()).message).toMatch(/hash/i);
  });

  test('calls without a session token: 401', async ({ request }) => {
    const res = await request.get(`${PREFIX}/tickets`, { headers: siteHeaders });
    expect(res.status()).toBe(401);
  });

  test('POST tickets: validation errors are 422 with errors keyed by field', async ({ request }) => {
    const { token } = await session(request);
    const res = await request.post(`${PREFIX}/tickets`, {
      headers: { ...auth(token), 'Idempotency-Key': randomUUID() },
      data: { ...ticketBody(), title: 'x', type: 'question' },
    });
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body.message).toEqual(expect.any(String));
    expect(Object.keys(body.errors)).toEqual(expect.arrayContaining(['title', 'type']));
  });

  test('POST tickets: 201, integer id, prefixed key, status to_do', async ({ request }) => {
    const { token } = await session(request);
    const res = await request.post(`${PREFIX}/tickets`, {
      headers: { ...auth(token), 'Idempotency-Key': randomUUID() },
      data: ticketBody(),
    });
    expect(res.status()).toBe(201);
    const { data } = await res.json();
    expect(data).toMatchObject({
      id: expect.any(Number),
      key: expect.stringMatching(/^[A-Z][A-Z0-9]*-\d+$/),
      type: 'bug',
      status: 'to_do',
      status_label: expect.any(String),
    });
    expect(Number.isInteger(data.id)).toBe(true);
  });

  test('POST tickets: the same Idempotency-Key returns the same ticket, not a duplicate', async ({ request }) => {
    const { token } = await session(request);
    const key = randomUUID();
    const first = await request.post(`${PREFIX}/tickets`, { headers: { ...auth(token), 'Idempotency-Key': key }, data: ticketBody('Once') });
    const second = await request.post(`${PREFIX}/tickets`, { headers: { ...auth(token), 'Idempotency-Key': key }, data: ticketBody('Once') });
    expect(first.status()).toBe(201);
    expect(second.status()).toBe(200);
    expect((await second.json()).data.id).toBe((await first.json()).data.id);

    const list = await request.get(`${PREFIX}/tickets`, { headers: auth(token) });
    expect((await list.json()).data.filter((t: { title: string }) => t.title === 'Once')).toHaveLength(1);
  });

  test('GET tickets and ticket detail: only the caller’s own tickets', async ({ request }) => {
    const ana = await session(request);
    const ben = await session(request);
    const created = await request.post(`${PREFIX}/tickets`, {
      headers: { ...auth(ana.token), 'Idempotency-Key': randomUUID() },
      data: ticketBody('Private to Ana'),
    });
    const id = (await created.json()).data.id as number;

    const list = await request.get(`${PREFIX}/tickets`, { headers: auth(ana.token) });
    expect(list.status()).toBe(200);
    expect((await list.json()).data.map((t: { id: number }) => t.id)).toContain(id);

    const detail = await request.get(`${PREFIX}/tickets/${id}`, { headers: auth(ana.token) });
    expect(detail.status()).toBe(200);
    expect((await detail.json()).data).toMatchObject({
      id,
      description: expect.any(String),
      blockers: expect.any(Array),
      summary: null,
      pull_request_url: null,
      timeline: expect.any(Array),
    });

    expect((await request.get(`${PREFIX}/tickets/${id}`, { headers: auth(ben.token) })).status()).toBe(404);
    expect((await (await request.get(`${PREFIX}/tickets`, { headers: auth(ben.token) })).json()).data).toEqual([]);
  });

  test('POST replies: 201 with the updated ticket', async ({ request }) => {
    const { token } = await session(request);
    const created = await request.post(`${PREFIX}/tickets`, { headers: { ...auth(token), 'Idempotency-Key': randomUUID() }, data: ticketBody() });
    const id = (await created.json()).data.id as number;
    const res = await request.post(`${PREFIX}/tickets/${id}/replies`, { headers: auth(token), data: { message: 'More detail: it happens on Safari only.' } });
    expect(res.status()).toBe(201);
    const { data } = await res.json();
    expect(data.timeline.some((e: { message: string; author: string }) => e.author === 'reporter' && e.message.includes('Safari'))).toBe(true);
  });

  test('uploads: signed URL accepts the file, a tampered signature is refused', async ({ request }) => {
    const { token } = await session(request);
    const bytes = Buffer.from('fake image bytes');
    const intent = await request.post(`${PREFIX}/uploads`, {
      headers: auth(token),
      data: { files: [{ name: 'screenshot.jpg', content_type: 'image/jpeg', size: bytes.length, kind: 'screenshot' }] },
    });
    expect(intent.status()).toBe(200);
    const [upload] = (await intent.json()).data;
    expect(upload).toMatchObject({ id: expect.any(String), upload_url: expect.any(String), method: 'PUT', expires_at: expect.any(String) });

    const tampered = upload.upload_url.replace(/signature=[^&]+/, 'signature=0000');
    expect((await request.put(tampered, { headers: upload.headers, data: bytes })).status()).toBe(403);

    const put = await request.put(upload.upload_url, { headers: upload.headers, data: bytes });
    expect(put.ok()).toBe(true);

    const created = await request.post(`${PREFIX}/tickets`, {
      headers: { ...auth(token), 'Idempotency-Key': randomUUID() },
      data: { ...ticketBody('With screenshot'), screenshot_id: upload.id },
    });
    expect(created.status()).toBe(201);
  });

  test('POST tickets: an upload id that was never uploaded is a 422', async ({ request }) => {
    const { token } = await session(request);
    const res = await request.post(`${PREFIX}/tickets`, {
      headers: { ...auth(token), 'Idempotency-Key': randomUUID() },
      data: { ...ticketBody(), screenshot_id: randomUUID() },
    });
    expect(res.status()).toBe(422);
    expect((await res.json()).errors).toEqual(expect.any(Object));
  });
});
