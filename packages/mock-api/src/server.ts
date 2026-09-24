/**
 * Mock Planora API. Implements the widget contract (/widget/v1) so the widget
 * can be built and tested end to end before the real Planora API exists.
 *
 *   http://localhost:8787/            ops page: move tickets through statuses
 *   http://localhost:8787/widget/v1/  the widget API
 *   http://localhost:8787/cdn/        acts as the CDN: loader.js + widget.js
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import {
  CreateTicketRequest,
  ENDPOINTS,
  HEADERS,
  ReplyRequest,
  SessionRequest,
  TicketStatus,
  UploadRequest,
  WIDGET_API_PREFIX,
  type WidgetUser,
} from '@planora/widget-contract';
import { z } from 'zod';
import { db, reset, save, sameReporter, toDetail, toSummary, type Reporter, type StoredTicket } from './db';
import { SITES, type Site } from './sites';

const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;
const here = dirname(fileURLToPath(import.meta.url));

interface Session {
  siteKey: string;
  reporter: Reporter;
  expiresAt: number;
}
const sessions = new Map<string, Session>();

/** Toggled from the ops page to simulate an outage (tests the offline queue). */
let chaos = false;

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 12 * 1024 * 1024 });

await app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', HEADERS.siteKey, HEADERS.idempotencyKey],
  maxAge: 600,
});

// Raw bodies for presigned uploads.
app.addContentTypeParser(/^(image|application\/(pdf|octet-stream))/, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

await app.register(fastifyStatic, {
  root: [resolve(here, '../../core/dist'), resolve(here, '../../loader/dist')],
  prefix: '/cdn/',
  setHeaders: (res) => res.header('Cache-Control', 'no-store'),
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } });
}

function originAllowed(site: Site, origin: string | undefined): boolean {
  if (site.allowedOrigins.includes('*')) return true;
  return Boolean(origin && site.allowedOrigins.includes(origin));
}

function resolveSite(request: FastifyRequest, reply: FastifyReply): Site | null {
  const key = request.headers[HEADERS.siteKey.toLowerCase()];
  const site = typeof key === 'string' ? SITES[key] : undefined;
  if (!site) {
    fail(reply, 401, 'invalid_site_key', 'Unknown site key.');
    return null;
  }
  if (!originAllowed(site, request.headers.origin)) {
    fail(reply, 403, 'origin_not_allowed', `Origin ${request.headers.origin ?? '(none)'} is not allowed for this site key.`);
    return null;
  }
  return site;
}

function resolveSession(request: FastifyRequest, reply: FastifyReply): { site: Site; session: Session } | null {
  const site = resolveSite(request, reply);
  if (!site) return null;
  const header = request.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const session = sessions.get(token);
  if (!session || session.siteKey !== site.key || session.expiresAt < Date.now()) {
    fail(reply, 401, 'invalid_session', 'Session expired. Start a new session.');
    return null;
  }
  return { site, session };
}

function parse<T>(schema: z.ZodType<T>, body: unknown, reply: FastifyReply): T | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    fail(reply, 400, 'validation_error', issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.');
    return null;
  }
  return result.data;
}

function verifyHash(site: Site, user: WidgetUser, hash: string | undefined): boolean {
  if (!hash) return false;
  const expected = createHmac('sha256', site.secret).update(user.id).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

function now(): string {
  return new Date().toISOString();
}

function findOwnTicket(id: string, siteKey: string, reporter: Reporter): StoredTicket | undefined {
  return db.tickets.find((t) => t.id === id && t.siteKey === siteKey && sameReporter(t.reporter, reporter));
}

// Chaos mode: fail every widget call except config (so the widget still boots).
app.addHook('onRequest', async (request, reply) => {
  if (chaos && request.url.startsWith(WIDGET_API_PREFIX) && request.method !== 'OPTIONS' && !request.url.startsWith(ENDPOINTS.config)) {
    return fail(reply, 503, 'unavailable', 'Planora is temporarily unavailable (chaos mode).');
  }
});

/* ------------------------------------------------------------------ */
/* Widget API                                                          */
/* ------------------------------------------------------------------ */

app.get(ENDPOINTS.config, async (request, reply) => {
  const site = resolveSite(request, reply);
  if (!site) return;
  return site.config;
});

app.post(ENDPOINTS.session, async (request, reply) => {
  const site = resolveSite(request, reply);
  if (!site) return;
  const body = parse(SessionRequest, request.body ?? {}, reply);
  if (!body) return;

  if (!body.user && site.config.mode === 'team') {
    return fail(reply, 401, 'identify_required', 'This site requires an identified user.');
  }
  if (body.user && site.requireUserHash && !verifyHash(site, body.user, body.user_hash)) {
    return fail(reply, 401, 'invalid_user_hash', 'The user hash does not match. Compute it on your server with your site secret.');
  }
  if (!body.user && !body.anonymous_id) return fail(reply, 400, 'validation_error', 'Provide user or anonymous_id.');

  const token = randomBytes(24).toString('hex');
  const expiresAt = Date.now() + 60 * 60 * 1000;
  sessions.set(token, {
    siteKey: site.key,
    reporter: { user: body.user ?? null, anonymousId: body.user ? null : (body.anonymous_id ?? null) },
    expiresAt,
  });
  return { token, expires_at: new Date(expiresAt).toISOString(), user: body.user ?? null };
});

app.post(ENDPOINTS.uploads, async (request, reply) => {
  const auth = resolveSession(request, reply);
  if (!auth) return;
  const body = parse(UploadRequest, request.body, reply);
  if (!body) return;
  const limits = auth.site.config.limits;
  if (body.files.some((f) => f.size > limits.max_attachment_bytes)) {
    return fail(reply, 413, 'file_too_large', 'One of the files is too large.');
  }
  const uploads = body.files.map((file) => {
    const id = `upl_${randomUUID().slice(0, 12)}`;
    db.uploads.push({ id, siteKey: auth.site.key, name: file.name, contentType: file.content_type, size: file.size, kind: file.kind, data: null });
    return { id, upload_url: `${PUBLIC_URL}${WIDGET_API_PREFIX}/uploads/${id}`, method: 'PUT' as const, headers: { 'Content-Type': file.content_type } };
  });
  save();
  return { uploads };
});

// Stands in for a presigned S3/R2 URL.
app.put<{ Params: { id: string } }>(`${WIDGET_API_PREFIX}/uploads/:id`, async (request, reply) => {
  const upload = db.uploads.find((u) => u.id === request.params.id);
  if (!upload) return fail(reply, 404, 'not_found', 'Unknown upload.');
  if (!Buffer.isBuffer(request.body)) return fail(reply, 400, 'invalid_body', 'Expected a file body.');
  upload.data = request.body.toString('base64');
  upload.size = request.body.length;
  save();
  return reply.status(200).send({ ok: true });
});

app.post(ENDPOINTS.tickets, async (request, reply) => {
  const auth = resolveSession(request, reply);
  if (!auth) return;
  const idempotencyKey = request.headers[HEADERS.idempotencyKey.toLowerCase()];
  const idemKey = typeof idempotencyKey === 'string' ? `${auth.site.key}:${idempotencyKey}` : null;
  if (idemKey && db.idempotency[idemKey]) {
    const existing = db.tickets.find((t) => t.id === db.idempotency[idemKey]);
    if (existing) return reply.status(200).send(toSummary(existing));
  }

  const body = parse(CreateTicketRequest, request.body, reply);
  if (!body) return;
  const ownUploads = new Set(db.uploads.filter((u) => u.siteKey === auth.site.key && u.data).map((u) => u.id));
  const missing = [...body.attachment_ids, ...(body.screenshot_id ? [body.screenshot_id] : [])].filter((id) => !ownUploads.has(id));
  if (missing.length) return fail(reply, 400, 'unknown_upload', `Uploads not found or not finished: ${missing.join(', ')}`);

  const at = now();
  db.counter += 1;
  const ticket: StoredTicket = {
    id: `tkt_${randomUUID().slice(0, 12)}`,
    key: `PLN-${db.counter}`,
    siteKey: auth.site.key,
    reporter: auth.session.reporter,
    type: body.type,
    title: body.title,
    description: body.description,
    status: 'to_do',
    createdAt: at,
    updatedAt: at,
    blockers: [],
    summary: null,
    pullRequestUrl: null,
    screenshotId: body.screenshot_id,
    attachmentIds: body.attachment_ids,
    context: body.context,
    timeline: [{ id: randomUUID(), at, kind: 'created', author: 'reporter', status: 'to_do', message: 'Ticket created' }],
  };
  db.tickets.push(ticket);
  if (idemKey) db.idempotency[idemKey] = ticket.id;
  save();
  request.log.info({ key: ticket.key, type: ticket.type }, 'ticket created');
  return reply.status(201).send(toSummary(ticket));
});

app.get<{ Querystring: { updated_since?: string } }>(ENDPOINTS.tickets, async (request, reply) => {
  const auth = resolveSession(request, reply);
  if (!auth) return;
  const since = request.query.updated_since ? new Date(request.query.updated_since).getTime() : 0;
  const tickets = db.tickets
    .filter((t) => t.siteKey === auth.site.key && sameReporter(t.reporter, auth.session.reporter))
    .filter((t) => new Date(t.updatedAt).getTime() > since)
    .map(toSummary);
  return { tickets, server_time: now() };
});

app.get<{ Params: { id: string } }>(`${ENDPOINTS.tickets}/:id`, async (request, reply) => {
  const auth = resolveSession(request, reply);
  if (!auth) return;
  const ticket = findOwnTicket(request.params.id, auth.site.key, auth.session.reporter);
  if (!ticket) return fail(reply, 404, 'not_found', 'Ticket not found.');
  return toDetail(ticket);
});

app.post<{ Params: { id: string } }>(`${ENDPOINTS.tickets}/:id/replies`, async (request, reply) => {
  const auth = resolveSession(request, reply);
  if (!auth) return;
  if (!auth.site.config.features.replies) return fail(reply, 403, 'replies_disabled', 'Replies are turned off for this site.');
  const ticket = findOwnTicket(request.params.id, auth.site.key, auth.session.reporter);
  if (!ticket) return fail(reply, 404, 'not_found', 'Ticket not found.');
  const body = parse(ReplyRequest, request.body, reply);
  if (!body) return;

  const at = now();
  ticket.timeline.push({ id: randomUUID(), at, kind: 'reply', author: 'reporter', message: body.message });
  // Mirrors Planora: answering a blocker re-queues the work.
  if (ticket.status === 'blocked') {
    ticket.status = 'in_progress';
    ticket.blockers = [];
    ticket.timeline.push({ id: randomUUID(), at, kind: 'status_changed', author: 'planora', status: 'in_progress', message: 'Thanks — work has resumed.' });
  }
  ticket.updatedAt = at;
  save();
  return toDetail(ticket);
});

/* ------------------------------------------------------------------ */
/* Ops (stands in for the Planora team + pipeline)                     */
/* ------------------------------------------------------------------ */

const opsHtml = readFileSync(resolve(here, 'ops.html'), 'utf8');
app.get('/', async (_request, reply) => reply.type('text/html').send(opsHtml));

app.get('/__ops/state', async () => ({
  chaos,
  sites: Object.keys(SITES),
  tickets: [...db.tickets]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((t) => ({ ...t, context: t.context ? { ...t.context, dom_snapshot: t.context.dom_snapshot ? `${t.context.dom_snapshot.length} chars` : null } : null })),
}));

const TransitionBody = z.object({
  status: TicketStatus,
  message: z.string().optional(),
  blockers: z.array(z.string().min(1)).optional(),
  summary: z.string().optional(),
  pull_request_url: z.string().optional(),
});

const DEFAULT_MESSAGES: Record<z.infer<typeof TicketStatus>, string> = {
  to_do: 'Moved back to To Do.',
  in_progress: 'Work has started on this ticket.',
  blocked: 'Work is paused — we need more information.',
  in_review: 'A fix is ready and waiting for review.',
  shipped: 'The fix has been merged.',
  declined: 'This ticket will not be worked on.',
};

app.post<{ Params: { id: string } }>('/__ops/tickets/:id/transition', async (request, reply) => {
  const ticket = db.tickets.find((t) => t.id === request.params.id);
  if (!ticket) return fail(reply, 404, 'not_found', 'Ticket not found.');
  const body = parse(TransitionBody, request.body, reply);
  if (!body) return;
  const at = now();
  ticket.status = body.status;
  ticket.blockers = body.status === 'blocked' ? (body.blockers ?? []).map((message) => ({ id: randomUUID(), message, needs_reply: true })) : [];
  if (body.summary !== undefined) ticket.summary = body.summary || null;
  if (body.pull_request_url !== undefined) ticket.pullRequestUrl = body.pull_request_url || null;
  ticket.timeline.push({ id: randomUUID(), at, kind: 'status_changed', author: 'planora', status: body.status, message: body.message || DEFAULT_MESSAGES[body.status] });
  ticket.updatedAt = at;
  save();
  return toDetail(ticket);
});

app.post<{ Body: { enabled?: boolean } }>('/__ops/chaos', async (request) => {
  chaos = Boolean(request.body?.enabled);
  return { chaos };
});

app.post('/__ops/reset', async () => {
  reset();
  sessions.clear();
  return { ok: true };
});

app.get<{ Params: { id: string } }>('/__ops/tickets/:id/snapshot', async (request, reply) => {
  const ticket = db.tickets.find((t) => t.id === request.params.id);
  if (!ticket?.context?.dom_snapshot) return fail(reply, 404, 'not_found', 'No page snapshot for this ticket.');
  return reply.type('text/plain').send(ticket.context.dom_snapshot);
});

app.get<{ Params: { id: string } }>('/__ops/uploads/:id', async (request, reply) => {
  const upload = db.uploads.find((u) => u.id === request.params.id);
  if (!upload?.data) return fail(reply, 404, 'not_found', 'Upload not found.');
  return reply.type(upload.contentType).send(Buffer.from(upload.data, 'base64'));
});

await app.listen({ port: PORT, host: '0.0.0.0' });
app.log.info(`Mock Planora API on ${PUBLIC_URL} — ops page at ${PUBLIC_URL}/`);
