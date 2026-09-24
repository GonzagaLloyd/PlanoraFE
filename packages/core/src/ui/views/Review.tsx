import { Body, Footer, Header, TypeLabel } from '../components/common';
import { useWidget, useWidgetState } from '../context';
import { t } from '../i18n';
import { detailParts } from './Report';

export function Review() {
  const widget = useWidget();
  const { draft, submitting, submitError } = useWidgetState();
  if (!draft) return null;

  const showShot = draft.includeScreenshot && draft.screenshotUrl;

  return (
    <>
      <Header title={t.reviewTitle} onBack={() => widget.navigate('report')} onClose={() => widget.close()} />
      <Body>
        <div class="pl-summary">
          <TypeLabel type={draft.type} />
          <h3>{draft.title.trim()}</h3>
          <p>{draft.description.trim()}</p>
          {showShot && <img src={draft.screenshotUrl!} alt={t.screenshot} />}
          <ul class="pl-kv">
            {draft.attachments.length > 0 && <li>{t.attachments(draft.attachments.length)}</li>}
            <li>{draft.includeDetails ? `${t.includeDetails}: ${t.detailsHint(detailParts(draft.context))}` : t.noDetails}</li>
          </ul>
        </div>
        {submitError && (
          <div class="pl-alert" role="alert">
            {submitError}
          </div>
        )}
      </Body>
      <Footer>
        <button type="button" class="pl-btn pl-btn-ghost" onClick={() => widget.navigate('report')} disabled={submitting}>
          {t.edit}
        </button>
        <button type="button" class="pl-btn pl-btn-primary" onClick={() => void widget.submit()} disabled={submitting} aria-busy={submitting}>
          {submitting && <span class="pl-spinner" aria-hidden="true" />}
          {submitting ? t.sending : t.send}
        </button>
      </Footer>
    </>
  );
}
