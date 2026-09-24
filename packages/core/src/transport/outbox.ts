import type { CaptureContext, TicketType } from '@planora/widget-contract';
import { storage } from '../util';

/** Reports that could not be sent yet. Stored in localStorage (survives tab close). */
export interface OutboxItem {
  /** Also used as the Idempotency-Key, so a resend can never create a duplicate. */
  id: string;
  createdAt: string;
  attempts: number;
  draft: {
    type: TicketType;
    title: string;
    description: string;
    context: CaptureContext | null;
  };
  files: Array<{ name: string; type: string; kind: 'screenshot' | 'attachment'; dataUrl: string }>;
  /** True when files were too large to keep and had to be dropped. */
  filesDropped: boolean;
}

/** localStorage is ~5 MB per origin and shared with the host site: stay small. */
export const OUTBOX_MAX_FILE_CHARS = 1_500_000;
const MAX_ITEMS = 10;
const MAX_ATTEMPTS = 20;

export class Outbox {
  constructor(private readonly key: string) {}

  list(): OutboxItem[] {
    return storage.get<OutboxItem[]>(this.key) ?? [];
  }

  save(item: OutboxItem): boolean {
    const items = this.list().filter((existing) => existing.id !== item.id);
    items.push(item);
    const trimmed = items.slice(-MAX_ITEMS);
    if (storage.set(this.key, trimmed)) return true;
    // Storage full: keep the text of the report, drop its files.
    const lean = trimmed.map((entry) => (entry.id === item.id ? { ...entry, files: [], filesDropped: entry.files.length > 0 } : entry));
    return storage.set(this.key, lean);
  }

  remove(id: string): void {
    const items = this.list().filter((item) => item.id !== id);
    if (items.length) storage.set(this.key, items);
    else storage.remove(this.key);
  }

  bumpAttempts(id: string): void {
    const items = this.list()
      .map((item) => (item.id === id ? { ...item, attempts: item.attempts + 1 } : item))
      .filter((item) => item.attempts <= MAX_ATTEMPTS);
    storage.set(this.key, items);
  }
}
