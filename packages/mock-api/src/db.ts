import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Blocker, CaptureContext, TicketDetail, TicketStatus, TicketSummary, TicketType, TimelineEntry, WidgetUser } from '@planora/widget-contract';
import { DEFAULT_STATUS_LABELS } from '@planora/widget-contract';

export interface Reporter {
  user: WidgetUser | null;
  anonymousId: string | null;
}

export interface StoredTicket {
  /** Integer ids, like every Planora table. */
  id: number;
  /** Site prefix + per-site number, e.g. SHOP-12. */
  key: string;
  siteKey: string;
  reporter: Reporter;
  type: TicketType;
  title: string;
  description: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  blockers: Blocker[];
  summary: string | null;
  pullRequestUrl: string | null;
  timeline: TimelineEntry[];
  screenshotId: string | null;
  attachmentIds: string[];
  context: CaptureContext | null;
}

export interface StoredUpload {
  id: string;
  siteKey: string;
  name: string;
  contentType: string;
  size: number;
  kind: 'screenshot' | 'attachment';
  /** base64, set once the browser PUTs the file */
  data: string | null;
}

interface Data {
  /** Auto-increment sequences, like Postgres serial columns. */
  sequences: { ticket: number; timeline: number; blocker: number };
  /** Next ticket number per site, for the human-facing key. */
  siteNumbers: Record<string, number>;
  tickets: StoredTicket[];
  uploads: StoredUpload[];
  /** "siteKey:Idempotency-Key" → ticket id */
  idempotency: Record<string, number>;
}

const here = dirname(fileURLToPath(import.meta.url));
// Versioned file name: data written by an older shape is ignored rather than misread.
const FILE = resolve(here, '../.data/db.v2.json');

function empty(): Data {
  return { sequences: { ticket: 0, timeline: 0, blocker: 0 }, siteNumbers: {}, tickets: [], uploads: [], idempotency: {} };
}

function load(): Data {
  try {
    if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, 'utf8')) as Data;
  } catch {
    /* start fresh */
  }
  return empty();
}

export const db: Data = load();

export function nextId(sequence: keyof Data['sequences']): number {
  db.sequences[sequence] += 1;
  return db.sequences[sequence];
}

export function nextTicketKey(siteKey: string, prefix: string): string {
  const number = (db.siteNumbers[siteKey] ?? 0) + 1;
  db.siteNumbers[siteKey] = number;
  return `${prefix}-${number}`;
}

let saveTimer: NodeJS.Timeout | null = null;
export function save(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(db));
  }, 200);
}

export function reset(): void {
  Object.assign(db, empty());
  save();
}

export function toSummary(ticket: StoredTicket): TicketSummary {
  return {
    id: ticket.id,
    key: ticket.key,
    type: ticket.type,
    title: ticket.title,
    status: ticket.status,
    status_label: DEFAULT_STATUS_LABELS[ticket.status],
    created_at: ticket.createdAt,
    updated_at: ticket.updatedAt,
  };
}

export function toDetail(ticket: StoredTicket): TicketDetail {
  return {
    ...toSummary(ticket),
    description: ticket.description,
    blockers: ticket.status === 'blocked' ? ticket.blockers : [],
    summary: ticket.summary,
    pull_request_url: ticket.pullRequestUrl,
    timeline: ticket.timeline,
  };
}

export function sameReporter(a: Reporter, b: Reporter): boolean {
  if (a.user && b.user) return a.user.id === b.user.id;
  if (!a.user && !b.user) return Boolean(a.anonymousId) && a.anonymousId === b.anonymousId;
  return false;
}
