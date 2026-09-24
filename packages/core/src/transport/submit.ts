import type { CaptureContext, TicketSummary, TicketType } from '@planora/widget-contract';
import { blobToDataUrl, dataUrlToBlob, nowIso } from '../util';
import type { ApiClient } from './api';
import { OUTBOX_MAX_FILE_CHARS, type Outbox, type OutboxItem } from './outbox';
import { isRetryable, withRetry } from './retry';

export interface ReportDraft {
  /** Generated when the draft is created; doubles as the Idempotency-Key. */
  id: string;
  type: TicketType;
  title: string;
  description: string;
  context: CaptureContext | null;
  screenshot: Blob | null;
  attachments: File[];
}

export type SubmitResult = { status: 'sent'; ticket: TicketSummary } | { status: 'queued'; localId: string };

interface PreparedFile {
  blob: Blob;
  name: string;
  type: string;
  kind: 'screenshot' | 'attachment';
}

const RETRY = { attempts: 3, baseDelayMs: 800 };

export class Submitter {
  private flushing = false;

  constructor(
    private readonly api: ApiClient,
    private readonly outbox: Outbox,
  ) {}

  /**
   * Upload files, then create the ticket. Retries transient failures; if they
   * persist the report is saved to the outbox and resent later. Validation
   * errors (4xx) are thrown so the UI can show them.
   */
  async submit(draft: ReportDraft): Promise<SubmitResult> {
    const files = prepareFiles(draft);
    try {
      const ticket = await this.send(draft, files);
      return { status: 'sent', ticket };
    } catch (error) {
      if (!isRetryable(error)) throw error;
      await this.saveToOutbox(draft, files);
      return { status: 'queued', localId: draft.id };
    }
  }

  /** Resend queued reports. Stops at the first transient failure. */
  async flush(onSent: (ticket: TicketSummary) => void): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (const item of this.outbox.list()) {
        const files: PreparedFile[] = item.files.map((file) => ({
          blob: dataUrlToBlob(file.dataUrl),
          name: file.name,
          type: file.type,
          kind: file.kind,
        }));
        const draft: ReportDraft = { id: item.id, ...item.draft, screenshot: null, attachments: [] };
        try {
          const ticket = await this.send(draft, files);
          this.outbox.remove(item.id);
          onSent(ticket);
        } catch (error) {
          if (isRetryable(error)) {
            this.outbox.bumpAttempts(item.id);
            break;
          }
          // The API rejected it outright; resending will never work.
          this.outbox.remove(item.id);
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  pendingCount(): number {
    return this.outbox.list().length;
  }

  private async send(draft: ReportDraft, files: PreparedFile[]): Promise<TicketSummary> {
    let screenshotId: string | null = null;
    const attachmentIds: string[] = [];

    if (files.length > 0) {
      const { uploads } = await withRetry(
        () =>
          this.api.requestUploads({
            files: files.map((file) => ({ name: file.name, content_type: file.type, size: file.blob.size, kind: file.kind })),
          }),
        RETRY,
      );
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        const upload = uploads[i];
        if (!upload) continue;
        await withRetry(() => this.api.putUpload(upload.upload_url, upload.headers, file.blob), RETRY);
        if (file.kind === 'screenshot') screenshotId = upload.id;
        else attachmentIds.push(upload.id);
      }
    }

    return withRetry(
      () =>
        this.api.createTicket(
          {
            type: draft.type,
            title: draft.title.trim(),
            description: draft.description.trim(),
            attachment_ids: attachmentIds,
            screenshot_id: screenshotId,
            context: draft.context,
          },
          draft.id,
        ),
      RETRY,
    );
  }

  private async saveToOutbox(draft: ReportDraft, files: PreparedFile[]): Promise<void> {
    const serialized: OutboxItem['files'] = [];
    let total = 0;
    let dropped = false;
    for (const file of files) {
      try {
        const dataUrl = await blobToDataUrl(file.blob);
        if (total + dataUrl.length > OUTBOX_MAX_FILE_CHARS) {
          dropped = true;
          continue;
        }
        total += dataUrl.length;
        serialized.push({ name: file.name, type: file.type, kind: file.kind, dataUrl });
      } catch {
        dropped = true;
      }
    }
    this.outbox.save({
      id: draft.id,
      createdAt: nowIso(),
      attempts: 0,
      draft: { type: draft.type, title: draft.title, description: draft.description, context: draft.context },
      files: serialized,
      filesDropped: dropped,
    });
  }
}

function prepareFiles(draft: ReportDraft): PreparedFile[] {
  const files: PreparedFile[] = [];
  if (draft.screenshot) {
    files.push({ blob: draft.screenshot, name: 'screenshot.jpg', type: draft.screenshot.type || 'image/jpeg', kind: 'screenshot' });
  }
  for (const file of draft.attachments) {
    files.push({ blob: file, name: file.name || 'attachment', type: file.type || 'application/octet-stream', kind: 'attachment' });
  }
  return files;
}
