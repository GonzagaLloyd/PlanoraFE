import { beforeEach, describe, expect, it } from 'vitest';
import type { TicketSummary } from '@planora/widget-contract';
import { TicketTracker } from '../src/store/tickets';
import { Outbox, type OutboxItem } from '../src/transport/outbox';

beforeEach(() => localStorage.clear());

describe('Outbox', () => {
  const item = (id: string): OutboxItem => ({
    id,
    createdAt: new Date().toISOString(),
    attempts: 0,
    draft: { type: 'bug', title: `Report ${id}`, description: 'desc', context: null },
    files: [],
    filesDropped: false,
  });

  it('saves, lists and removes queued reports', () => {
    const outbox = new Outbox('test:outbox');
    outbox.save(item('a'));
    outbox.save(item('b'));
    expect(outbox.list().map((i) => i.id)).toEqual(['a', 'b']);
    outbox.remove('a');
    expect(outbox.list().map((i) => i.id)).toEqual(['b']);
  });

  it('replaces an item with the same id instead of duplicating it', () => {
    const outbox = new Outbox('test:outbox');
    outbox.save(item('a'));
    outbox.save({ ...item('a'), attempts: 3 });
    expect(outbox.list()).toHaveLength(1);
    expect(outbox.list()[0]?.attempts).toBe(3);
  });

  it('keeps at most 10 reports, dropping the oldest', () => {
    const outbox = new Outbox('test:outbox');
    for (let i = 0; i < 12; i++) outbox.save(item(String(i)));
    expect(outbox.list()).toHaveLength(10);
    expect(outbox.list()[0]?.id).toBe('2');
  });
});

describe('TicketTracker', () => {
  const ticket = (id: string, status: TicketSummary['status'], updated: string): TicketSummary => ({
    id,
    key: `PLN-${id}`,
    type: 'bug',
    title: id,
    status,
    status_label: status,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: updated,
  });

  it('does not flag existing history as unread on first run', () => {
    const tracker = new TicketTracker('test:seen');
    const tickets = [ticket('1', 'to_do', '2026-09-01T10:00:00Z')];
    tracker.update(tickets);
    expect(tracker.unread(tickets)).toEqual({});
  });

  it('flags newer updates and reports status changes', () => {
    const tracker = new TicketTracker('test:seen');
    tracker.update([ticket('1', 'to_do', '2026-09-01T10:00:00Z')]);
    const next = [ticket('1', 'blocked', '2026-09-01T11:00:00Z')];
    expect(tracker.update(next)).toEqual([{ ticket: next[0], previous: 'to_do' }]);
    expect(tracker.unread(next)).toEqual({ '1': true });
    tracker.markSeen(next[0]!);
    expect(tracker.unread(next)).toEqual({});
  });

  it('remembers what was seen across page loads', () => {
    new TicketTracker('test:seen').update([ticket('1', 'to_do', '2026-09-01T10:00:00Z')]);
    const reloaded = new TicketTracker('test:seen');
    expect(reloaded.unread([ticket('1', 'shipped', '2026-09-02T10:00:00Z')])).toEqual({ '1': true });
  });
});
