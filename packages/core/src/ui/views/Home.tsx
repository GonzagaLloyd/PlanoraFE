import { Body, Header, TicketList } from '../components/common';
import { useWidget, useWidgetState } from '../context';
import { t } from '../i18n';
import { IconBug, IconChevron, IconSpark } from '../icons';

export function Home() {
  const widget = useWidget();
  const state = useWidgetState();
  const recent = state.tickets.slice(0, 3);

  return (
    <>
      <Header title={state.config?.site_name || t.newReport} onClose={() => widget.close()} />
      <Body>
        <div class="pl-hello">
          <small>{t.hello(state.user?.name)}</small>
          <strong>{t.howCanWeHelp}</strong>
        </div>

        <div class="pl-choices">
          <button type="button" class="pl-choice" onClick={() => widget.startReport('bug')}>
            <span class="pl-choice-icon">
              <IconBug />
            </span>
            <span class="pl-choice-text">
              <b>{t.reportBug}</b>
              <small>{t.reportBugHint}</small>
            </span>
            <IconChevron class="pl-choice-arrow" />
          </button>
          <button type="button" class="pl-choice" onClick={() => widget.startReport('feature')}>
            <span class="pl-choice-icon">
              <IconSpark />
            </span>
            <span class="pl-choice-text">
              <b>{t.requestFeature}</b>
              <small>{t.requestFeatureHint}</small>
            </span>
            <IconChevron class="pl-choice-arrow" />
          </button>
        </div>

        {state.pendingCount > 0 && <div class="pl-note">{t.pendingReports(state.pendingCount)}</div>}

        {recent.length > 0 && (
          <div class="pl-field">
            <div class="pl-section-head">
              <h3>{t.yourTickets}</h3>
              {state.tickets.length > recent.length && (
                <button type="button" class="pl-link" onClick={() => widget.navigate('list')}>
                  {t.seeAll(state.tickets.length)}
                  <IconChevron width={14} height={14} />
                </button>
              )}
            </div>
            <TicketList tickets={recent} unread={state.unread} onOpen={(id) => void widget.openTicket(id)} />
          </div>
        )}
      </Body>
      <div class="pl-powered">{t.poweredBy}</div>
    </>
  );
}
