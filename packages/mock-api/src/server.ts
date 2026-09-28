/**
 * Mock Planora API. Implements the widget contract (/api/v1/widget) exactly as
 * the Laravel implementation in Planora should: same paths, `{ data }` bodies,
 * Laravel-style errors (`{ message, errors }`, 422 for validation), integer ids,
 * and signed upload URLs. docs/WIDGET_API.md is the written spec of the same.
 *
 *   http://localhost:8787/                 ops page: move tickets through statuses
 *   http://localhost:8787/api/v1/widget/   the widget API
 *   http://localhost:8787/cdn/             acts as the CDN: loader.js + widget.js
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
import { db, nextId, nextTicketKey, reset, save, sameReporter, toDetail, toSummary, type Reporter, type StoredTicket } from './db';
import { SITES, type Site } from './sites';

const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;
const here = dirname(fileURLToPath(import.meta.url));

/** Signs upload URLs, like Laravel's APP_KEY does for URL::temporarySignedRoute. */
const SIGNING_KEY = randomBytes(32);
const UPLOAD_URL_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 60 * 60 * 1000;

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
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization', HEADERS.siteKey, HEADERS.idempotencyKey],
  maxAge: 600,
});

// Raw bodies for signed uploads.
app.addContentTypeParser(/^(image|application\/(pdf|octet-stream))/, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

await app.register(fastifyStatic, {
  root: [resolve(here, '../../core/dist'), resolve(here, '../../loader/dist')],
  prefix: '/cdn/',
  setHeaders: (res) => res.header('Cache-Control', 'no-store'),
});

/* ------------------------------------------------------------------ */
/* Helpers: responses shaped like Laravel's                            */
/* ------------------------------------------------------------------ */

/** JsonResource-style success body. */
function ok<T>(reply: FastifyReply, data: T, status = 200) {
  return reply.status(status).send({ data });
}

/** Laravel's default error body: abort(status, message) / ValidationException. */
function fail(reply: FastifyReply, status: number, message: string, errors?: Record<string, string[]>) {
  return reply.status(status).send(errors ? { message, errors } : { message });
}

function originAllowed(site: Site, origin: string | undefined): boolean {
  if (site.allowedOrigins.includes('*')) return true;
  return Boolean(origin && site.allowedOrigins.includes(origin));
}

function resolveSite(request: FastifyRequest, reply: FastifyReply): Site | null {
  const key = request.headers[HEADERS.siteKey.toLowerCase()];
  const site = typeof key === 'string' ? SITES[key] : undefined;
  if (!site) {
    fail(reply, 401, 'Unknown site key.');
    return null;
  }
  if (!originAllowed(site, request.headers.origin)) {
    fail(reply, 403, `Origin ${request.headers.origin ?? '(none)'} is not allowed for this site key.`);
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
    fail(reply, 401, 'Unauthenticated.');
    return null;
  }
  return { site, session };
}

/** Validates like a FormRequest: 422 with `errors` keyed by dotted field path. */
function validate<T>(schema: z.ZodType<T>, body: unknown, reply: FastifyReply): T | null {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const errors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const field = issue.path.join('.') || 'body';
    (errors[field] ??= []).push(`The ${field} field is invalid: ${issue.message}`);
  }
  const fields = Object.keys(errors);
  const summary = `${errors[fields[0]!]![0]}${fields.length > 1 ? ` (and ${fields.length - 1} more error${fields.length > 2 ? 's' : ''})` : ''}`;
  fail(reply, 422, summary, errors);
  return null;
}

function verifyHash(site: Site, user: WidgetUser, hash: string | undefined): boolean {
  if (!hash) return false;
  const expected = createHmac('sha256', site.secret).update(user.id).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

function signUpload(id: string, expires: number): string {
  return createHmac('sha256', SIGNING_KEY).update(`${id}:${expires}`).digest('hex');
}

function now(): string {
  return new Date().toISOString();
}

function findOwnTicket(rawId: string, siteKey: string, reporter: Reporter): StoredTicket | undefined {
  const id = Number(rawId);
  return db.tickets.find((t) => t.id === id && t.siteKey === siteKey && sameReporter(t.reporter, reporter));
}

// Chaos mode: fail every widget call except config (so the widget still boots).
app.addHook('onRequest', async (request, reply) => {
  if (chaos && request.url.startsWith(WIDGET_API_PREFIX) && request.method !== 'OPTIONS' && !request.url.startsWith(ENDPOINTS.config)) {
    return fail(reply, 503, 'Service Unavailable');
  }
});

/* ------------------------------------------------------------------ */
/* Widget API                                                          */
/* ------------------------------------------------------------------ */

app.get(ENDPOINTS.config, async (request, reply) => {
  const site = resolveSite(request, reply);
  if (!site) return;
  return ok(reply, site.config);
});

app.post(ENDPOINTS.session, async (request, reply) => {
  const site = resolveSite(request, reply);
  if (!site) return;
  const body = validate(SessionRequest, request.body ?? {}, reply);
  if (!body) return;

  if (!body.user && site.config.mode === 'team') {
    return fail(reply, 401, 'This site requires an identified user.');
  }
  if (body.user && site.requireUserHash && !verifyHash(site, body.user, body.user_hash)) {
    return fail(reply, 401, 'The user hash does not match. Compute it on your server with your site secret.');
  }
  if (!body.user && !body.anonymous_id) {
    return fail(reply, 422, 'The anonymous id field is required when user is not present.', {
      anonymous_id: ['The anonymous id field is required when user is not present.'],
    });
  }

  const token = randomBytes(24).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, {
    siteKey: site.key,
    reporter: { user: body.user ?? null, anonymousId: body.user ? null : (body.anonymous_id ?? null) },
    expiresAt,
  });
  return ok(reply, { token, expires_at: new Date(expiresAt).toISOString(), user: body.user ?? null });
});

app.post(ENDPOINTS.uploads, async (request, reply) => {
  const auth = resolveSession(request, reply);
  if (!auth) return;
  const body = validate(UploadRequest, request.body, reply);
  if (!body) return;
  const limits = auth.site.config.limits;
  const tooLarge = body.files.findIndex((f) => f.size > limits.max_attachment_bytes);
  if (tooLarge !== -1) {
    const message = `The file may not be greater than ${Math.round(limits.max_attachment_bytes / 1024)} kilobytes.`;
    return fail(reply, 422, message, { [`files.${tooLarge}.size`]: [message] });
  }
  const expires = Date.now() + UPLOAD_URL_TTL_MS;
  const uploads = body.files.map((file) => {
    const id = randomUUID();
    db.uploads.push({ id, siteKey: auth.site.key, name: file.name, contentType: file.content_type, size: file.size, kind: file.kind, data: null });
    const query = `expires=${Math.floor(expires / 1000)}&signature=${signUpload(id, Math.floor(expires / 1000))}`;
    return {
      id,
      upload_url: `${PUBLIC_URL}${WIDGET_API_PREFIX}/uploads/${id}?${query}`,
      method: 'PUT' as const,
      headers: { 'Content-Type': file.content_type },
      expires_at: new Date(expires).toISOString(),
    };
  });
  save();
  return ok(reply, uploads);
});

// Stands in for a signed route (URL::temporarySignedRoute) or an S3 presigned URL:
// the signature is the only authorization, no session header.
app.put<{ Params: { id: string }; Querystring: { expires?: string; signature?: string } }>(
  `${WIDGET_API_PREFIX}/uploads/:id`,
  async (request, reply) => {
    const expires = Number(request.query.expires);
    const signature = request.query.signature ?? '';
    const expected = signUpload(request.params.id, expires);
    const valid =
      Number.isFinite(expires) &&
      expires * 1000 > Date.now() &&
      signature.length === expected.length &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!valid) return fail(reply, 403, 'Invalid signature.');

    const upload = db.uploads.find((u) => u.id === request.params.id);
    if (!upload) return fail(reply, 404, 'Upload not found.');
    if (!Buffer.isBuffer(request.body)) return fail(reply, 422, 'The file field is required.', { file: ['The file field is required.'] });
    upload.data = request.body.toString('base64');
    upload.size = request.body.length;
    save();
    return reply.status(204).send();
  },
);

app.post(ENDPOINTS.tickets, async (request, reply) => {
  const auth = resolveSession(request, reply);
  if (!auth) return;
  const idempotencyKey = request.headers[HEADERS.idempotencyKey.toLowerCase()];
  const idemKey = typeof idempotencyKey === 'string' ? `${auth.site.key}:${idempotencyKey}` : null;
  if (idemKey && db.idempotency[idemKey]) {
    const existing = db.tickets.find((t) => t.id === db.idempotency[idemKey]);
    // A replay returns the original ticket with 200, not a second 201.
    if (existing) return ok(reply, toSummary(existing));
  }

  const body = validate(CreateTicketRequest, request.body, reply);
  if (!body) return;
  const ownUploads = new Set(db.uploads.filter((u) => u.siteKey === auth.site.key && u.data).map((u) => u.id));
  const missing = [...body.attachment_ids, ...(body.screenshot_id ? [body.screenshot_id] : [])].filter((id) => !ownUploads.has(id));
  if (missing.length) {
    const message = 'One or more uploads were not found or not finished.';
    return fail(reply, 422, message, { attachment_ids: [message] });
  }

  const at = now();
  const ticket: StoredTicket = {
    id: nextId('ticket'),
    key: nextTicketKey(auth.site.key, auth.site.ticketPrefix),
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
    timeline: [{ id: nextId('timeline'), at, kind: 'created', author: 'reporter', status: 'to_do', message: 'Ticket created' }],
  };
  db.tickets.push(ticket);
  if (idemKey) db.idempotency[idemKey] = ticket.id;
  save();
  request.log.info({ key: ticket.key, type: ticket.type }, 'ticket created');
  return ok(reply, toSummary(ticket), 201);
});

app.get<{ Querystring: { updated_since?: string } }>(ENDPOINTS.tickets, async (request, reply) => {
  const auth = resolveSession(request, reply);
  if (!auth) return;
  const since = request.query.updated_since ? new Date(request.query.updated_since).getTime() : 0;
  const tickets = db.tickets
    .filter((t) => t.siteKey === auth.site.key && sameReporter(t.reporter, auth.session.reporter))
    .filter((t) => new Date(t.updatedAt).getTime() > since)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(toSummary);
  return ok(reply, tickets);
});

app.get<{ Params: { id: string } }>(`${ENDPOINTS.tickets}/:id`, async (request, reply) => {
  const auth = resolveSession(request, reply);
  if (!auth) return;
  const ticket = findOwnTicket(request.params.id, auth.site.key, auth.session.reporter);
  if (!ticket) return fail(reply, 404, 'Ticket not found.');
  return ok(reply, toDetail(ticket));
});

app.post<{ Params: { id: string } }>(`${ENDPOINTS.tickets}/:id/replies`, async (request, reply) => {
  const auth = resolveSession(request, reply);
  if (!auth) return;
  if (!auth.site.config.features.replies) return fail(reply, 403, 'Replies are turned off for this site.');
  const ticket = findOwnTicket(request.params.id, auth.site.key, auth.session.reporter);
  if (!ticket) return fail(reply, 404, 'Ticket not found.');
  const body = validate(ReplyRequest, request.body, reply);
  if (!body) return;

  const at = now();
  ticket.timeline.push({ id: nextId('timeline'), at, kind: 'reply', author: 'reporter', message: body.message });
  // Mirrors Planora: answering a blocker re-queues the work.
  if (ticket.status === 'blocked') {
    ticket.status = 'in_progress';
    ticket.blockers = [];
    ticket.timeline.push({
      id: nextId('timeline'),
      at,
      kind: 'status_changed',
      author: 'planora',
      status: 'in_progress',
      message: 'Thanks — work has resumed.',
    });
  }
  ticket.updatedAt = at;
  save();
  return ok(reply, toDetail(ticket), 201);
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
  const ticket = db.tickets.find((t) => t.id === Number(request.params.id));
  if (!ticket) return fail(reply, 404, 'Ticket not found.');
  const body = validate(TransitionBody, request.body, reply);
  if (!body) return;
  const at = now();
  ticket.status = body.status;
  ticket.blockers =
    body.status === 'blocked' ? (body.blockers ?? []).map((message) => ({ id: nextId('blocker'), message, needs_reply: true })) : [];
  if (body.summary !== undefined) ticket.summary = body.summary || null;
  if (body.pull_request_url !== undefined) ticket.pullRequestUrl = body.pull_request_url || null;
  ticket.timeline.push({
    id: nextId('timeline'),
    at,
    kind: 'status_changed',
    author: 'planora',
    status: body.status,
    message: body.message || DEFAULT_MESSAGES[body.status],
  });
  ticket.updatedAt = at;
  save();
  return ok(reply, toDetail(ticket));
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
  const ticket = db.tickets.find((t) => t.id === Number(request.params.id));
  if (!ticket?.context?.dom_snapshot) return fail(reply, 404, 'No page snapshot for this ticket.');
  return reply.type('text/plain').send(ticket.context.dom_snapshot);
});

app.get<{ Params: { id: string } }>('/__ops/uploads/:id', async (request, reply) => {
  const upload = db.uploads.find((u) => u.id === request.params.id);
  if (!upload?.data) return fail(reply, 404, 'Upload not found.');
  return reply.type(upload.contentType).send(Buffer.from(upload.data, 'base64'));
});

await app.listen({ port: PORT, host: '0.0.0.0' });
app.log.info(`Mock Planora API on ${PUBLIC_URL} — ops page at ${PUBLIC_URL}/`);
