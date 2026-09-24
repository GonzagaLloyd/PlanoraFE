/**
 * The contract between the Planora widget and the Planora API (/widget/v1).
 *
 * Both sides import these schemas: the widget uses the types, the API (and the
 * mock API) validates request bodies with the zod schemas. Changing a schema
 * here is a breaking change for both sides — bump WIDGET_API_VERSION.
 */
import { z } from 'zod';

export * from './constants';
import { TICKET_STATUSES } from './constants';
import type { TicketStatus as TicketStatusValue } from './constants';

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export const TicketType = z.enum(['bug', 'feature']);
export type TicketType = z.infer<typeof TicketType>;

/**
 * Statuses the widget can display. The Planora API maps its internal job and
 * ticket states onto these; the widget never sees internal states.
 */
export const TicketStatus = z.enum(TICKET_STATUSES);
export type TicketStatus = TicketStatusValue;

export const WidgetMode = z.enum(['team', 'public']);
export type WidgetMode = z.infer<typeof WidgetMode>;

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

export const WidgetUser = z.object({
  id: z.string().min(1).max(200),
  name: z.string().max(200).optional(),
  email: z.string().max(320).optional(),
});
export type WidgetUser = z.infer<typeof WidgetUser>;

export const SessionRequest = z.object({
  /** Identified user (team mode, or public mode with a logged-in visitor). */
  user: WidgetUser.optional(),
  /** HMAC-SHA256(user.id, site secret), hex. Computed on the client's server. */
  user_hash: z.string().max(200).optional(),
  /** Random per-browser id used when no user is identified (public mode). */
  anonymous_id: z.string().max(100).optional(),
});
export type SessionRequest = z.infer<typeof SessionRequest>;

export const SessionResponse = z.object({
  token: z.string(),
  expires_at: z.string(),
  user: WidgetUser.nullable(),
});
export type SessionResponse = z.infer<typeof SessionResponse>;

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export const WidgetConfig = z.object({
  enabled: z.boolean(),
  site_name: z.string(),
  mode: WidgetMode,
  branding: z.object({
    primary_color: z.string(),
    launcher_label: z.string(),
    position: z.enum(['bottom-right', 'bottom-left']),
  }),
  features: z.object({
    screenshot: z.boolean(),
    attachments: z.boolean(),
    replies: z.boolean(),
  }),
  limits: z.object({
    max_attachments: z.number().int(),
    max_attachment_bytes: z.number().int(),
  }),
});
export type WidgetConfig = z.infer<typeof WidgetConfig>;

/* ------------------------------------------------------------------ */
/* Uploads                                                             */
/* ------------------------------------------------------------------ */

export const UploadRequest = z.object({
  files: z
    .array(
      z.object({
        name: z.string().max(255),
        content_type: z.string().max(100),
        size: z.number().int().nonnegative(),
        kind: z.enum(['screenshot', 'attachment']),
      }),
    )
    .min(1)
    .max(10),
});
export type UploadRequest = z.infer<typeof UploadRequest>;

export const UploadResponse = z.object({
  uploads: z.array(
    z.object({
      id: z.string(),
      upload_url: z.string(),
      method: z.literal('PUT'),
      headers: z.record(z.string(), z.string()),
    }),
  ),
});
export type UploadResponse = z.infer<typeof UploadResponse>;

/* ------------------------------------------------------------------ */
/* Capture context (what the widget records automatically)             */
/* ------------------------------------------------------------------ */

export const ConsoleEntry = z.object({
  level: z.enum(['log', 'info', 'warn', 'error', 'debug']),
  message: z.string(),
  at: z.string(),
});
export type ConsoleEntry = z.infer<typeof ConsoleEntry>;

export const ErrorEntry = z.object({
  message: z.string(),
  stack: z.string().optional(),
  source: z.string().optional(),
  kind: z.enum(['error', 'unhandledrejection']),
  at: z.string(),
});
export type ErrorEntry = z.infer<typeof ErrorEntry>;

export const NetworkEntry = z.object({
  method: z.string(),
  url: z.string(),
  status: z.number().int(),
  /** true when the request never got a response (offline, CORS, aborted). */
  failed: z.boolean(),
  duration_ms: z.number(),
  at: z.string(),
});
export type NetworkEntry = z.infer<typeof NetworkEntry>;

export const NavigationEntry = z.object({
  url: z.string(),
  at: z.string(),
});
export type NavigationEntry = z.infer<typeof NavigationEntry>;

export const CaptureContext = z.object({
  page_url: z.string(),
  page_title: z.string(),
  referrer: z.string(),
  user_agent: z.string(),
  language: z.string(),
  timezone: z.string(),
  viewport: z.object({ width: z.number(), height: z.number() }),
  screen: z.object({ width: z.number(), height: z.number(), pixel_ratio: z.number() }),
  captured_at: z.string(),
  console: z.array(ConsoleEntry).max(100),
  errors: z.array(ErrorEntry).max(50),
  network: z.array(NetworkEntry).max(50),
  navigation: z.array(NavigationEntry).max(50),
  /** Sanitized, size-capped HTML of the page. Null when the reporter opted out. */
  dom_snapshot: z.string().max(300_000).nullable(),
  /** Custom key/values from Planora('setMetadata', …), e.g. app version, tenant. */
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  sdk: z.object({ name: z.string(), version: z.string() }),
});
export type CaptureContext = z.infer<typeof CaptureContext>;

/* ------------------------------------------------------------------ */
/* Tickets                                                             */
/* ------------------------------------------------------------------ */

export const CreateTicketRequest = z.object({
  type: TicketType,
  title: z.string().min(3).max(200),
  description: z.string().min(1).max(10_000),
  attachment_ids: z.array(z.string()).max(10),
  screenshot_id: z.string().nullable(),
  context: CaptureContext.nullable(),
});
export type CreateTicketRequest = z.infer<typeof CreateTicketRequest>;

export const Blocker = z.object({
  id: z.string(),
  /** Plain-language reason or question, safe to show the reporter. */
  message: z.string(),
  /** True when Planora needs a reply before it can continue. */
  needs_reply: z.boolean(),
});
export type Blocker = z.infer<typeof Blocker>;

export const TicketSummary = z.object({
  id: z.string(),
  key: z.string(),
  type: TicketType,
  title: z.string(),
  status: TicketStatus,
  status_label: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type TicketSummary = z.infer<typeof TicketSummary>;

export const TimelineEntry = z.object({
  id: z.string(),
  at: z.string(),
  kind: z.enum(['created', 'status_changed', 'reply', 'note']),
  /** Who produced the entry. `planora` = the Planora team or pipeline. */
  author: z.enum(['reporter', 'planora']),
  status: TicketStatus.optional(),
  message: z.string(),
});
export type TimelineEntry = z.infer<typeof TimelineEntry>;

export const TicketDetail = TicketSummary.extend({
  description: z.string(),
  blockers: z.array(Blocker),
  /** Plain-language summary of what was fixed. Present once shipped. */
  summary: z.string().nullable(),
  pull_request_url: z.string().nullable(),
  timeline: z.array(TimelineEntry),
});
export type TicketDetail = z.infer<typeof TicketDetail>;

export const CreateTicketResponse = TicketSummary;
export type CreateTicketResponse = z.infer<typeof CreateTicketResponse>;

export const ListTicketsResponse = z.object({
  tickets: z.array(TicketSummary),
  server_time: z.string(),
});
export type ListTicketsResponse = z.infer<typeof ListTicketsResponse>;

export const ReplyRequest = z.object({
  message: z.string().min(1).max(5_000),
  blocker_id: z.string().optional(),
});
export type ReplyRequest = z.infer<typeof ReplyRequest>;

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;
