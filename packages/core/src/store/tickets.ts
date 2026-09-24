import type { TicketStatus, TicketSummary } from '@planora/widget-contract';
import { storage } from '../util';

interface SeenRecord {
  /** ticket id → updated_at the user last saw */
  seen: Record<string, string>;
  initialized: boolean;
}

/**
 * Tracks which ticket updates the user has already seen (for the badge) and
 * detects status changes between refreshes (for the `status:changed` event).
 */
export class TicketTracker {
  private record: SeenRecord;
  private statuses = new Map<string, TicketStatus>();

  constructor(private readonly key: string) {
    this.record = storage.get<SeenRecord>(key) ?? { seen: {}, initialized: false };
  }

  /** Returns tickets whose status changed since the previous call. */
  update(tickets: TicketSummary[]): Array<{ ticket: TicketSummary; previous: TicketStatus }> {
    const changes: Array<{ ticket: TicketSummary; previous: TicketStatus }> = [];
    const firstRun = this.statuses.size === 0;
    for (const ticket of tickets) {
      const previous = this.statuses.get(ticket.id);
      if (!firstRun && previous && previous !== ticket.status) changes.push({ ticket, previous });
      this.statuses.set(ticket.id, ticket.status);
    }
    // First time on this browser: treat everything existing as seen, so the
    // badge doesn't light up for history the user already knows about.
    if (!this.record.initialized) {
      for (const ticket of tickets) this.record.seen[ticket.id] = ticket.updated_at;
      this.record.initialized = true;
      this.persist();
    }
    return changes;
  }

  unread(tickets: TicketSummary[]): Record<string, true> {
    const out: Record<string, true> = {};
    for (const ticket of tickets) {
      const seenAt = this.record.seen[ticket.id];
      if (!seenAt || new Date(ticket.updated_at).getTime() > new Date(seenAt).getTime()) out[ticket.id] = true;
    }
    return out;
  }

  markSeen(ticket: Pick<TicketSummary, 'id' | 'updated_at'>): void {
    this.record.seen[ticket.id] = ticket.updated_at;
    this.persist();
  }

  private persist(): void {
    storage.set(this.key, this.record);
  }
}
