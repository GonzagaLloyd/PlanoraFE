import type { ComponentChildren } from 'preact';
import type { TicketStatus, TicketSummary, TicketType } from '@planora/widget-contract';
import { DEFAULT_STATUS_LABELS } from '@planora/widget-contract/constants';
import { relativeTime } from '../../util';
import { t } from '../i18n';
import { IconBack, IconBug, IconClose, IconSpark } from '../icons';

export function StatusChip({ status, label }: { status: TicketStatus; label?: string }) {
  return (
    <span class="pl-chip" data-status={status}>
      {label || DEFAULT_STATUS_LABELS[status]}
    </span>
  );
}

export function TypeLabel({ type }: { type: TicketType }) {
  return (
    <span class="pl-type">
      {type === 'bug' ? <IconBug /> : <IconSpark />}
      {type === 'bug' ? t.bug : t.feature}
    </span>
  );
}

export function Header({ title, onBack, onClose }: { title: string; onBack?: () => void; onClose: () => void }) {
  return (
    <div class="pl-header">
      {onBack && (
        <button type="button" class="pl-icon-btn" onClick={onBack} aria-label={t.back}>
          <IconBack />
        </button>
      )}
      <h2 id="pl-panel-title">{title}</h2>
      <button type="button" class="pl-icon-btn" onClick={onClose} aria-label={t.close}>
        <IconClose />
      </button>
    </div>
  );
}

export function TicketList({
  tickets,
  unread,
  onOpen,
}: {
  tickets: TicketSummary[];
  unread: Record<string, true>;
  onOpen: (id: string) => void;
}) {
  return (
    <ul class="pl-tickets">
      {tickets.map((ticket) => (
        <li key={ticket.id}>
          <button type="button" class="pl-ticket" onClick={() => onOpen(ticket.id)}>
            <span class="pl-ticket-title">
              {unread[ticket.id] && <span class="pl-unread" aria-label="New update" />}
              <span>{ticket.title}</span>
            </span>
            <span class="pl-ticket-meta">
              {ticket.key} · {relativeTime(ticket.updated_at)}
            </span>
            <StatusChip status={ticket.status} label={ticket.status_label} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Body({ children }: { children: ComponentChildren }) {
  return <div class="pl-body">{children}</div>;
}

export function Footer({ children }: { children: ComponentChildren }) {
  return <div class="pl-footer">{children}</div>;
}
