import { Body, Footer, Header } from '../components/common';
import { useWidget, useWidgetState } from '../context';
import { t } from '../i18n';
import { IconCheck, IconClock } from '../icons';

export function Sent() {
  const widget = useWidget();
  const { lastResult, config } = useWidgetState();
  const queued = lastResult?.status === 'queued';

  return (
    <>
      <Header title={config?.site_name || t.newReport} onClose={() => widget.close()} />
      <Body>
        <div class="pl-done" role="status">
          <span class={`pl-done-icon${queued ? ' pl-queued' : ''}`}>{queued ? <IconClock /> : <IconCheck />}</span>
          <h3>{queued ? t.queuedTitle : t.sentTitle}</h3>
          <p>
            {lastResult?.status === 'sent'
              ? t.sentBody(lastResult.ticket.key, lastResult.ticket.status_label)
              : t.queuedBody}
          </p>
        </div>
      </Body>
      <Footer>
        {lastResult?.status === 'sent' && (
          <button type="button" class="pl-btn" onClick={() => void widget.openTicket(lastResult.ticket.id)}>
            {t.viewTicket}
          </button>
        )}
        <button type="button" class="pl-btn pl-btn-primary" onClick={() => widget.close()}>
          {t.done}
        </button>
      </Footer>
    </>
  );
}
