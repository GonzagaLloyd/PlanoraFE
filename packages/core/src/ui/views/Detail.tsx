import { useState } from 'preact/hooks';
import type { TicketDetail } from '@planora/widget-contract';
import { relativeTime } from '../../util';
import { Body, Header, StatusChip, TypeLabel } from '../components/common';
import { useWidget, useWidgetState } from '../context';
import { t } from '../i18n';
import { IconAlert, IconCheck, IconClock, IconExternal } from '../icons';

function safeHttpUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function ReplyBox({ blocked, blockerId }: { blocked: boolean; blockerId?: string }) {
  const widget = useWidget();
  const { replying } = useWidgetState();
  const [message, setMessage] = useState('');
  const id = blocked ? 'pl-reply-blocked' : 'pl-reply';

  const send = async () => {
    if (await widget.reply(message, blockerId)) setMessage('');
  };

  return (
    <div class="pl-reply">
      <label class="pl-sr" for={id}>
        {blocked ? t.replyPlaceholder : t.commentPlaceholder}
      </label>
      <textarea
        id={id}
        class="pl-textarea"
        value={message}
        maxLength={5000}
        placeholder={blocked ? t.replyPlaceholder : t.commentPlaceholder}
        onInput={(e) => setMessage(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
        }}
      />
      <div class="pl-reply-actions">
        <button
          type="button"
          class={`pl-btn${blocked ? ' pl-btn-primary' : ''}`}
          disabled={replying || !message.trim()}
          onClick={() => void send()}
        >
          {replying && <span class="pl-spinner" aria-hidden="true" />}
          {blocked ? t.sendReply : t.sendComment}
        </button>
      </div>
    </div>
  );
}

function StatusCard({ detail, repliesEnabled }: { detail: TicketDetail; repliesEnabled: boolean }) {
  const prUrl = safeHttpUrl(detail.pull_request_url);

  if (detail.status === 'blocked') {
    const needsReply = detail.blockers.find((b) => b.needs_reply);
    return (
      <div class="pl-card pl-card-blocked">
        <h4>
          <IconAlert />
          {t.blockedTitle}
        </h4>
        <p class="pl-muted">{t.blockedBody}</p>
        {detail.blockers.length > 0 && (
          <ul class="pl-blockers">
            {detail.blockers.map((blocker) => (
              <li key={blocker.id}>{blocker.message}</li>
            ))}
          </ul>
        )}
        {repliesEnabled && <ReplyBox blocked blockerId={needsReply?.id} />}
      </div>
    );
  }

  if (detail.status === 'in_review') {
    return (
      <div class="pl-card pl-card-review">
        <h4>
          <IconClock />
          {t.reviewCardTitle}
        </h4>
        <p>{t.reviewCardBody}</p>
        {prUrl && (
          <a class="pl-link" href={prUrl} target="_blank" rel="noopener noreferrer">
            {t.viewPullRequest}
            <IconExternal width={14} height={14} />
          </a>
        )}
      </div>
    );
  }

  if (detail.status === 'shipped') {
    return (
      <div class="pl-card pl-card-shipped">
        <h4>
          <IconCheck />
          {t.shippedTitle}
        </h4>
        {detail.summary && <p>{detail.summary}</p>}
        {prUrl && (
          <a class="pl-link" href={prUrl} target="_blank" rel="noopener noreferrer">
            {t.viewPullRequest}
            <IconExternal width={14} height={14} />
          </a>
        )}
      </div>
    );
  }

  if (detail.status === 'declined' && detail.summary) {
    return (
      <div class="pl-card">
        <h4>{t.declinedTitle}</h4>
        <p>{detail.summary}</p>
      </div>
    );
  }

  return null;
}

export function Detail() {
  const widget = useWidget();
  const { detail, detailLoading, detailError, selectedId, tickets, config } = useWidgetState();
  const summary = tickets.find((ticket) => ticket.id === selectedId);
  const repliesEnabled = config?.features.replies !== false;
  const closed = detail?.status === 'shipped' || detail?.status === 'declined';

  return (
    <>
      <Header title={detail?.key ?? summary?.key ?? ''} onBack={() => widget.navigate('list')} onClose={() => widget.close()} />
      <Body>
        {detailLoading && !detail && (
          <div class="pl-field" aria-busy="true">
            <div class="pl-skeleton" />
            <div class="pl-skeleton" style={{ width: '60%' }} />
            <div class="pl-skeleton" style={{ width: '80%' }} />
          </div>
        )}

        {detailError && (
          <div class="pl-alert" role="alert">
            {detailError}
          </div>
        )}

        {detail && (
          <>
            <div class="pl-detail-head">
              <TypeLabel type={detail.type} />
              <h3>{detail.title}</h3>
              <div class="pl-row">
                <StatusChip status={detail.status} label={detail.status_label} />
                <span class="pl-muted">{t.updated(relativeTime(detail.updated_at))}</span>
              </div>
            </div>

            <StatusCard detail={detail} repliesEnabled={repliesEnabled} />

            <div class="pl-field">
              <div class="pl-section-head">
                <h3>{t.description}</h3>
              </div>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{detail.description}</p>
            </div>

            {detail.timeline.length > 0 && (
              <div class="pl-field">
                <div class="pl-section-head">
                  <h3>{t.activity}</h3>
                </div>
                <ol class="pl-timeline">
                  {detail.timeline.map((entry) => (
                    <li key={entry.id}>
                      <span class="pl-dot" data-author={entry.author} aria-hidden="true" />
                      <div>
                        <p>{entry.message}</p>
                        <span class="pl-muted">
                          {entry.author === 'reporter' ? t.you : t.planora} · {relativeTime(entry.at)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {repliesEnabled && !closed && detail.status !== 'blocked' && <ReplyBox blocked={false} />}
          </>
        )}
      </Body>
    </>
  );
}
