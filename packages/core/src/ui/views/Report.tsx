import { useEffect, useRef, useState } from 'preact/hooks';
import type { CaptureContext } from '@planora/widget-contract';
import type { DraftState } from '../../store/store';
import { formatBytes } from '../../util';
import { Body, Footer, Header } from '../components/common';
import { useWidget, useWidgetState } from '../context';
import { t } from '../i18n';
import { IconBug, IconClose, IconImage, IconPaperclip, IconSpark } from '../icons';

export function validateDraft(draft: DraftState): { title?: string; description?: string } {
  const errors: { title?: string; description?: string } = {};
  if (draft.title.trim().length < 3) errors.title = t.titleTooShort;
  if (!draft.description.trim()) errors.description = t.descriptionRequired;
  return errors;
}

export function detailParts(context: CaptureContext | null): string[] {
  if (!context) return [];
  const errors = context.errors.length + context.console.filter((entry) => entry.level === 'error').length;
  const failed = context.network.length;
  const parts: string[] = [];
  if (errors) parts.push(`${errors} ${errors === 1 ? 'error' : 'errors'}`);
  if (failed) parts.push(`${failed} failed or slow ${failed === 1 ? 'request' : 'requests'}`);
  parts.push('page address, browser');
  return parts;
}

export function Report() {
  const widget = useWidget();
  const { draft, config } = useWidgetState();
  const [showErrors, setShowErrors] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleInput.current?.focus();
  }, []);

  if (!draft) return null;

  const errors = showErrors ? validateDraft(draft) : {};
  const maxFiles = config?.limits.max_attachments ?? 5;
  const maxBytes = config?.limits.max_attachment_bytes ?? 10 * 1024 * 1024;

  const addFiles = (files: File[]) => {
    setFileError(null);
    const next = [...draft.attachments];
    for (const file of files) {
      if (next.length >= maxFiles) {
        setFileError(t.tooManyFiles(maxFiles));
        break;
      }
      if (file.size > maxBytes) {
        setFileError(t.fileTooLarge(file.name || 'This file', formatBytes(maxBytes)));
        continue;
      }
      next.push(file);
    }
    widget.updateDraft({ attachments: next });
  };

  const onPaste = (event: ClipboardEvent) => {
    const items = Array.from(event.clipboardData?.items ?? []);
    const images = items
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (images.length) {
      event.preventDefault();
      addFiles(images.map((file, i) => (file.name && file.name !== 'image.png' ? file : new File([file], `pasted-${Date.now()}-${i}.png`, { type: file.type }))));
    }
  };

  const goToReview = () => {
    const found = validateDraft(draft);
    if (found.title || found.description) {
      setShowErrors(true);
      return;
    }
    widget.navigate('review');
  };

  const type = draft.type;

  return (
    <>
      <Header title={t.newReport} onBack={() => widget.navigate('home')} onClose={() => widget.close()} />
      <Body>
        <div class="pl-segment" role="group" aria-label="Report type">
          <button type="button" aria-pressed={type === 'bug'} onClick={() => widget.updateDraft({ type: 'bug' })}>
            <IconBug />
            {t.bug}
          </button>
          <button type="button" aria-pressed={type === 'feature'} onClick={() => widget.updateDraft({ type: 'feature' })}>
            <IconSpark />
            {t.feature}
          </button>
        </div>

        <div class="pl-field">
          <label class="pl-label" for="pl-title">
            {t.titleLabel}
          </label>
          <input
            id="pl-title"
            ref={titleInput}
            class={`pl-input${errors.title ? ' pl-invalid' : ''}`}
            value={draft.title}
            maxLength={200}
            placeholder={t.titlePlaceholder[type]}
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? 'pl-title-error' : undefined}
            onInput={(e) => widget.updateDraft({ title: e.currentTarget.value })}
          />
          {errors.title && (
            <span id="pl-title-error" class="pl-error-text">
              {errors.title}
            </span>
          )}
        </div>

        <div class="pl-field">
          <label class="pl-label" for="pl-description">
            {t.descriptionLabel[type]}
          </label>
          <span class="pl-hint" id="pl-description-hint">
            {t.descriptionHint[type]}
          </span>
          <textarea
            id="pl-description"
            class={`pl-textarea${errors.description ? ' pl-invalid' : ''}`}
            value={draft.description}
            maxLength={10_000}
            aria-invalid={Boolean(errors.description)}
            aria-describedby={errors.description ? 'pl-description-error' : 'pl-description-hint'}
            onInput={(e) => widget.updateDraft({ description: e.currentTarget.value })}
            onPaste={onPaste}
          />
          {errors.description && (
            <span id="pl-description-error" class="pl-error-text">
              {errors.description}
            </span>
          )}
        </div>

        {config?.features.screenshot !== false && (
          <div class="pl-shot">
            {draft.screenshotUrl ? (
              <img src={draft.screenshotUrl} alt={t.screenshot} />
            ) : (
              <span class="pl-shot-placeholder">{draft.screenshotStatus === 'capturing' ? <span class="pl-spinner" /> : <IconImage />}</span>
            )}
            <div class="pl-shot-body">
              <span class="pl-label">{t.screenshot}</span>
              {draft.screenshotStatus === 'capturing' && <span class="pl-hint">{t.capturingScreenshot}</span>}
              {draft.screenshotStatus === 'unavailable' && <span class="pl-hint">{t.screenshotUnavailable}</span>}
              {draft.screenshotStatus === 'ready' && (
                <label class="pl-check">
                  <input
                    id="pl-include-screenshot"
                    type="checkbox"
                    checked={draft.includeScreenshot}
                    onChange={(e) => widget.updateDraft({ includeScreenshot: e.currentTarget.checked })}
                  />
                  <span>{t.includeScreenshot}</span>
                </label>
              )}
            </div>
          </div>
        )}

        {config?.features.attachments !== false && (
          <div class="pl-field">
            <div class="pl-row">
              <button type="button" class="pl-btn" onClick={() => fileInput.current?.click()}>
                <IconPaperclip />
                {t.attachImages}
              </button>
              <input
                id="pl-files"
                ref={fileInput}
                type="file"
                accept="image/*,application/pdf"
                multiple
                hidden
                onChange={(e) => {
                  addFiles(Array.from(e.currentTarget.files ?? []));
                  e.currentTarget.value = '';
                }}
              />
            </div>
            <span class="pl-hint">{t.pasteHint}</span>
            {fileError && <span class="pl-error-text">{fileError}</span>}
            {draft.attachments.length > 0 && (
              <div class="pl-files">
                {draft.attachments.map((file, index) => (
                  <span class="pl-file" key={`${file.name}-${index}`}>
                    <span title={file.name}>{file.name}</span>
                    <button
                      type="button"
                      aria-label={t.removeFile(file.name)}
                      onClick={() => widget.updateDraft({ attachments: draft.attachments.filter((_, i) => i !== index) })}
                    >
                      <IconClose />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <label class="pl-check">
          <input
            id="pl-include-details"
            type="checkbox"
            checked={draft.includeDetails}
            onChange={(e) => widget.updateDraft({ includeDetails: e.currentTarget.checked })}
          />
          <span>
            {t.includeDetails}
            <br />
            <span class="pl-hint">{t.detailsHint(detailParts(draft.context))}</span>
          </span>
        </label>
      </Body>
      <Footer>
        <button type="button" class="pl-btn pl-btn-ghost" onClick={() => widget.discardDraft()}>
          {t.cancel}
        </button>
        <button type="button" class="pl-btn pl-btn-primary" onClick={goToReview}>
          {t.review}
        </button>
      </Footer>
    </>
  );
}
