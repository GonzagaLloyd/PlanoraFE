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
  id: string;
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
  counter: number;
  tickets: StoredTicket[];
  uploads: StoredUpload[];
  idempotency: Record<string, string>;
}

const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(here, '../.data/db.json');

function load(): Data {
  try {
    if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, 'utf8')) as Data;
  } catch {
    /* start fresh */
  }
  return { counter: 100, tickets: [], uploads: [], idempotency: {} };
}

export const db: Data = load();

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
  db.counter = 100;
  db.tickets = [];
  db.uploads = [];
  db.idempotency = {};
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
