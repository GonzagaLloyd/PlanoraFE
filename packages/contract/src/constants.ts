/**
 * Runtime constants with no dependencies. The widget imports only this entry
 * (@planora/widget-contract/constants) so zod never ends up in its bundle.
 */
export const WIDGET_API_VERSION = 'v1';

/**
 * Planora serves every route under `api/v1` (see apps/api/bootstrap/app.php),
 * and `api/*` is also where its CORS config and Scramble's OpenAPI export look,
 * so the widget routes live inside it rather than beside it.
 */
export const WIDGET_API_PREFIX = `/api/${WIDGET_API_VERSION}/widget`;

export const ENDPOINTS = {
  session: `${WIDGET_API_PREFIX}/session`,
  config: `${WIDGET_API_PREFIX}/config`,
  uploads: `${WIDGET_API_PREFIX}/uploads`,
  tickets: `${WIDGET_API_PREFIX}/tickets`,
  ticket: (id: number | string) => `${WIDGET_API_PREFIX}/tickets/${encodeURIComponent(String(id))}`,
  replies: (id: number | string) => `${WIDGET_API_PREFIX}/tickets/${encodeURIComponent(String(id))}/replies`,
} as const;

export const HEADERS = {
  siteKey: 'X-Planora-Site-Key',
  idempotencyKey: 'Idempotency-Key',
  authorization: 'Authorization',
} as const;

export const TICKET_STATUSES = ['to_do', 'in_progress', 'blocked', 'in_review', 'shipped', 'declined'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Default English labels. The API sends its own `status_label`, which wins. */
export const DEFAULT_STATUS_LABELS: Record<TicketStatus, string> = {
  to_do: 'To Do',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  in_review: 'In Review',
  shipped: 'Shipped',
  declined: 'Declined',
};
