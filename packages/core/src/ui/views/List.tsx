import { Body, Header, TicketList } from '../components/common';
import { useWidget, useWidgetState } from '../context';
import { t } from '../i18n';

export function List() {
  const widget = useWidget();
  const { tickets, unread, ticketsLoaded, ticketsError } = useWidgetState();

  return (
    <>
      <Header title={t.allTickets} onBack={() => widget.navigate('home')} onClose={() => widget.close()} />
      <Body>
        {!ticketsLoaded && (
          <div class="pl-field" aria-busy="true">
            <div class="pl-skeleton" />
            <div class="pl-skeleton" style={{ width: '70%' }} />
          </div>
        )}
        {ticketsLoaded && ticketsError && tickets.length === 0 && (
          <div class="pl-empty">
            <span>{ticketsError}</span>
            <button type="button" class="pl-btn" onClick={() => void widget.refreshTickets()}>
              {t.retry}
            </button>
          </div>
        )}
        {ticketsLoaded && !ticketsError && tickets.length === 0 && <div class="pl-empty">{t.noTickets}</div>}
        {tickets.length > 0 && <TicketList tickets={tickets} unread={unread} onOpen={(id) => void widget.openTicket(id)} />}
      </Body>
    </>
  );
}
