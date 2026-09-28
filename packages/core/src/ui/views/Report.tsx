import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CaptureContext } from '@planora/widget-contract';
import type { DraftState } from '../../store/store';
import { formatBytes } from '../../util';
import { Body, Footer, Header } from '../components/common';
import { useWidget, useWidgetState } from '../context';
import { t } from '../i18n';
import { IconBug, IconClose, IconFile, IconPlus, IconSpark } from '../icons';

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
  if (failed) parts.push(`${failed} failed ${failed === 1 ? 'request' : 'requests'}`);
  parts.push('page address, browser');
  return parts;
}

/** Object URLs for image previews, revoked when the files change or the view closes. */
function usePreviews(files: File[]): Array<string | null> {
  const urls = useMemo(() => files.map((file) => (file.type.startsWith('image/') ? URL.createObjectURL(file) : null)), [files]);
  useEffect(() => () => urls.forEach((url) => url && URL.revokeObjectURL(url)), [urls]);
  return urls;
}

export function Report() {
  const widget = useWidget();
  const { draft, config } = useWidgetState();
  const [showErrors, setShowErrors] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const previews = usePreviews(draft?.attachments ?? []);

  useEffect(() => {
    titleInput.current?.focus();
  }, []);

  if (!draft) return null;

  const errors = showErrors ? validateDraft(draft) : {};
  const maxFiles = config?.limits.max_attachments ?? 5;
  const maxBytes = config?.limits.max_attachment_bytes ?? 10 * 1024 * 1024;
  const screenshotOn = config?.features.screenshot !== false && draft.screenshotStatus !== 'unavailable';
  const attachmentsOn = config?.features.attachments !== false;
  const canAddMore = attachmentsOn && draft.attachments.length < maxFiles;

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
    if (!attachmentsOn) return;
    const images = Array.from(event.clipboardData?.items ?? [])
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
  const details = detailParts(draft.context);

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
          <textarea
            id="pl-description"
            class={`pl-textarea${errors.description ? ' pl-invalid' : ''}`}
            value={draft.description}
            maxLength={10_000}
            placeholder={t.descriptionHint[type]}
            aria-invalid={Boolean(errors.description)}
            aria-describedby={errors.description ? 'pl-description-error' : undefined}
            onInput={(e) => widget.updateDraft({ description: e.currentTarget.value })}
            onPaste={onPaste}
          />
          {errors.description && (
            <span id="pl-description-error" class="pl-error-text">
              {errors.description}
            </span>
          )}
        </div>

        {(screenshotOn || attachmentsOn) && (
          <div class="pl-field">
            <div class="pl-label-row">
              <span class="pl-label" id="pl-attachments-label">
                {t.attachmentsLabel}
              </span>
              {attachmentsOn && <span class="pl-hint">{t.pasteHint}</span>}
            </div>
            <div class="pl-tiles" role="group" aria-labelledby="pl-attachments-label">
              {screenshotOn && draft.includeScreenshot && (
                <div class="pl-tile pl-tile-shot">
                  {draft.screenshotUrl ? (
                    <img src={draft.screenshotUrl} alt={t.screenshot} />
                  ) : (
                    <span class="pl-tile-empty" aria-label={t.capturingScreenshot}>
                      <span class="pl-spinner" />
                    </span>
                  )}
                  <span class="pl-tile-tag">{t.screenshotTag}</span>
                  {draft.screenshotStatus === 'ready' && (
                    <button type="button" class="pl-tile-remove" aria-label={t.removeScreenshot} onClick={() => widget.updateDraft({ includeScreenshot: false })}>
                      <IconClose />
                    </button>
                  )}
                </div>
              )}

              {draft.attachments.map((file, index) => (
                <div class="pl-tile" key={`${file.name}-${index}`} title={file.name}>
                  {previews[index] ? (
                    <img src={previews[index]!} alt={file.name} />
                  ) : (
                    <span class="pl-tile-empty">
                      <IconFile />
                    </span>
                  )}
                  <button
                    type="button"
                    class="pl-tile-remove"
                    aria-label={t.removeFile(file.name)}
                    onClick={() => widget.updateDraft({ attachments: draft.attachments.filter((_, i) => i !== index) })}
                  >
                    <IconClose />
                  </button>
                </div>
              ))}

              {screenshotOn && !draft.includeScreenshot && (
                <button type="button" class="pl-tile pl-tile-add" onClick={() => widget.updateDraft({ includeScreenshot: true })}>
                  <IconPlus />
                  <span>{t.screenshotTag}</span>
                </button>
              )}

              {canAddMore && (
                <button type="button" class="pl-tile pl-tile-add" aria-label={t.attachImages} onClick={() => fileInput.current?.click()}>
                  <IconPlus />
                  <span>{t.addFile}</span>
                </button>
              )}
            </div>
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
            {fileError && <span class="pl-error-text">{fileError}</span>}
          </div>
        )}

        <label class="pl-switch-row" for="pl-include-details">
          <span class="pl-switch-text">
            <span>{t.includeDetails}</span>
            <span class="pl-hint">{t.detailsHint(details)}</span>
          </span>
          <input
            id="pl-include-details"
            class="pl-switch"
            type="checkbox"
            role="switch"
            checked={draft.includeDetails}
            onChange={(e) => widget.updateDraft({ includeDetails: e.currentTarget.checked })}
          />
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
