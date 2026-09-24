import type { CaptureContext, SessionRequest, TicketSummary, TicketType, WidgetConfig, WidgetUser } from '@planora/widget-contract';
import { Capture, captureScreenshot, type Metadata } from './capture';
import { Emitter, type Listener, type PlanoraEventName } from './events';
import { type DraftState, initialState, Store, type View, type WidgetState } from './store/store';
import { TicketTracker } from './store/tickets';
import { ApiClient, ApiRequestError } from './transport/api';
import { Outbox } from './transport/outbox';
import { Submitter } from './transport/submit';
import { storage, uuid } from './util';

export const DEFAULT_API_BASE = 'https://api.planora.dev';

export interface PlanoraUser extends WidgetUser {
  /** HMAC-SHA256(user.id, site secret), hex — computed on your server, never in the browser. */
  userHash?: string;
}

export interface InitOptions {
  /** Public site key from the Planora dashboard (pk_live_… / pk_test_…). */
  siteKey: string;
  /** Planora API origin. Defaults to https://api.planora.dev. */
  apiBase?: string;
  /** The logged-in user. Required in team mode before the bubble appears. */
  user?: PlanoraUser | null;
  /** Extra context attached to every report, e.g. { appVersion: '2.3.1', tenant: 'acme' }. */
  metadata?: Metadata;
  /** Overrides the dashboard branding. */
  position?: 'bottom-right' | 'bottom-left';
  primaryColor?: string;
  launcherLabel?: string;
  /** Hide the floating bubble and open the widget from your own button with Planora.open(). */
  hideLauncher?: boolean;
  /** Turn off console or network recording. Both default to on. */
  captureConsole?: boolean;
  captureNetwork?: boolean;
  zIndex?: number;
}

/** Used when the config endpoint is unreachable, so reports can still be queued offline. */
const FALLBACK_CONFIG: WidgetConfig = {
  enabled: true,
  site_name: '',
  mode: 'team',
  branding: { primary_color: '#C94A16', launcher_label: 'Report an issue', position: 'bottom-right' },
  features: { screenshot: true, attachments: true, replies: true },
  limits: { max_attachments: 5, max_attachment_bytes: 10 * 1024 * 1024 },
};

const OPEN_POLL_MS = 30_000;
const IDLE_POLL_MS = 5 * 60_000;

interface OpenSnapshot {
  context: CaptureContext;
  screenshot: Promise<Blob | null> | null;
}

interface UiHandle {
  host: HTMLElement;
  unmount: () => void;
}

export type UiMounter = (widget: PlanoraWidget, options: { hideLauncher?: boolean; zIndex?: number }) => UiHandle;

export class PlanoraWidget {
  readonly store = new Store<WidgetState>(initialState);
  private readonly emitter = new Emitter();
  private options: InitOptions | null = null;
  private capture: Capture | null = null;
  private api: ApiClient | null = null;
  private submitter: Submitter | null = null;
  private tracker: TicketTracker | null = null;
  private ui: UiHandle | null = null;
  private metadata: Metadata = {};
  private pendingUser: PlanoraUser | null | undefined;
  private snapshot: OpenSnapshot | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private removeListeners: Array<() => void> = [];
  private currentUserHash: string | undefined;
  private initialized = false;

  constructor(private readonly mountUi: UiMounter) {}

  /* ---------------------------------------------------------------- */
  /* Public API                                                        */
  /* ---------------------------------------------------------------- */

  init(options: InitOptions): void {
    if (typeof window === 'undefined') return; // SSR: no-op
    if (this.initialized) {
      console.warn('[Planora] init() called twice; call shutdown() first to re-initialize.');
      return;
    }
    if (!options?.siteKey) {
      console.error('[Planora] init() needs a siteKey.');
      return;
    }
    this.initialized = true;
    this.options = options;
    this.metadata = { ...options.metadata };

    const apiBase = (options.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, '');
    this.capture = new Capture({
      ignoreUrls: () => [apiBase],
      console: options.captureConsole,
      network: options.captureNetwork,
    });
    this.capture.install();

    this.api = new ApiClient(apiBase, options.siteKey, () => this.sessionRequest());
    this.submitter = new Submitter(this.api, new Outbox(`planora:outbox:${options.siteKey}`));

    const user = this.pendingUser !== undefined ? this.pendingUser : (options.user ?? null);
    this.pendingUser = undefined;
    this.setUser(user);

    void this.boot();
  }

  identify(user: PlanoraUser | null): void {
    if (!this.initialized) {
      this.pendingUser = user;
      return;
    }
    const current = this.store.state.user;
    if (current?.id === user?.id && current?.name === user?.name && current?.email === user?.email) return;
    this.api?.resetSession();
    this.setUser(user);
    this.store.set({ tickets: [], unread: {}, ticketsLoaded: false, detail: null, selectedId: null });
    this.updateReady();
    void this.afterIdentity();
  }

  open(view?: 'home' | 'report' | 'list'): void {
    const state = this.store.state;
    if (!state.ready) return;
    if (!state.open) {
      this.takeSnapshot();
      this.store.set({ open: true });
      this.emitter.emit('open', undefined);
      void this.refreshTickets();
      this.schedulePolling();
    }
    if (view === 'report') this.startReport('bug');
    else if (view) this.navigate(view);
    else if (!state.open && !state.draft) this.navigate('home');
  }

  close(): void {
    if (!this.store.state.open) return;
    this.store.set({ open: false });
    if (!this.store.state.draft) this.snapshot = null;
    this.schedulePolling();
    this.emitter.emit('close', undefined);
  }

  toggle(): void {
    if (this.store.state.open) this.close();
    else this.open();
  }

  setMetadata(metadata: Metadata): void {
    this.metadata = { ...this.metadata, ...metadata };
  }

  on<E extends PlanoraEventName>(event: E, listener: Listener<E>): () => void {
    return this.emitter.on(event, listener);
  }

  shutdown(): void {
    if (!this.initialized) return;
    this.ui?.unmount();
    this.ui = null;
    this.capture?.uninstall();
    this.capture = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.removeListeners.forEach((fn) => fn());
    this.removeListeners = [];
    this.revokeDraftUrl(this.store.state.draft);
    this.store.set({ ...initialState });
    this.emitter.clear();
    this.api = null;
    this.submitter = null;
    this.tracker = null;
    this.snapshot = null;
    this.options = null;
    this.initialized = false;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  /* ---------------------------------------------------------------- */
  /* Actions used by the UI                                            */
  /* ---------------------------------------------------------------- */

  navigate(view: View): void {
    this.store.set({ view, submitError: null });
  }

  startReport(type: TicketType): void {
    const existing = this.store.state.draft;
    if (existing) {
      this.store.set({ draft: { ...existing, type }, view: 'report' });
      return;
    }
    if (!this.snapshot) this.takeSnapshot();
    const config = this.store.state.config ?? FALLBACK_CONFIG;
    const snapshot = this.snapshot!;
    const draft: DraftState = {
      id: uuid(),
      type,
      title: '',
      description: '',
      attachments: [],
      includeScreenshot: config.features.screenshot,
      includeDetails: true,
      screenshot: null,
      screenshotUrl: null,
      screenshotStatus: snapshot.screenshot ? 'capturing' : 'unavailable',
      context: snapshot.context,
    };
    this.store.set({ draft, view: 'report', submitError: null });

    if (snapshot.screenshot) {
      const draftId = draft.id;
      void snapshot.screenshot.then((blob) => {
        const current = this.store.state.draft;
        if (!current || current.id !== draftId) return;
        this.store.set({
          draft: {
            ...current,
            screenshot: blob,
            screenshotUrl: blob ? URL.createObjectURL(blob) : null,
            screenshotStatus: blob ? 'ready' : 'unavailable',
          },
        });
      });
    }
  }

  updateDraft(patch: Partial<Pick<DraftState, 'type' | 'title' | 'description' | 'attachments' | 'includeScreenshot' | 'includeDetails'>>): void {
    const draft = this.store.state.draft;
    if (!draft) return;
    this.store.set({ draft: { ...draft, ...patch } });
  }

  discardDraft(): void {
    this.revokeDraftUrl(this.store.state.draft);
    this.snapshot = null;
    this.store.set({ draft: null, view: 'home', submitError: null });
  }

  async submit(): Promise<void> {
    const { draft, submitting } = this.store.state;
    if (!draft || submitting || !this.submitter) return;
    this.store.set({ submitting: true, submitError: null });
    try {
      const result = await this.submitter.submit({
        id: draft.id,
        type: draft.type,
        title: draft.title,
        description: draft.description,
        context: draft.context ? (draft.includeDetails ? draft.context : stripDetails(draft.context)) : null,
        screenshot: draft.includeScreenshot ? draft.screenshot : null,
        attachments: draft.attachments,
      });
      this.revokeDraftUrl(draft);
      this.snapshot = null;
      if (result.status === 'sent') {
        this.tracker?.markSeen(result.ticket);
        this.upsertTicket(result.ticket);
        this.emitter.emit('ticket:created', { ticket: result.ticket });
      } else {
        this.emitter.emit('ticket:queued', { localId: result.localId });
      }
      this.store.set({
        submitting: false,
        draft: null,
        lastResult: result,
        view: 'sent',
        pendingCount: this.submitter.pendingCount(),
      });
    } catch (error) {
      this.store.set({
        submitting: false,
        submitError: error instanceof Error ? error.message : 'Something went wrong. Please try again.',
      });
    }
  }

  async openTicket(id: string): Promise<void> {
    if (!this.api) return;
    this.store.set({ view: 'detail', selectedId: id, detailLoading: true, detailError: null, detail: null });
    try {
      const detail = await this.api.getTicket(id);
      if (this.store.state.selectedId !== id) return;
      this.tracker?.markSeen(detail);
      this.upsertTicket(detail);
      this.store.set({ detail, detailLoading: false });
    } catch (error) {
      this.store.set({ detailLoading: false, detailError: errorMessage(error, 'Could not load this ticket.') });
    }
  }

  async reply(message: string, blockerId?: string): Promise<boolean> {
    const { selectedId, replying } = this.store.state;
    if (!this.api || !selectedId || replying || !message.trim()) return false;
    this.store.set({ replying: true, detailError: null });
    try {
      const detail = await this.api.reply(selectedId, { message: message.trim(), blocker_id: blockerId });
      this.tracker?.markSeen(detail);
      this.upsertTicket(detail);
      this.store.set({ detail, replying: false });
      return true;
    } catch (error) {
      this.store.set({ replying: false, detailError: errorMessage(error, 'Your reply was not sent. Please try again.') });
      return false;
    }
  }

  async refreshTickets(): Promise<void> {
    const { config, user } = this.store.state;
    if (!this.api || !config) return;
    if (config.mode === 'team' && !user) return;
    try {
      const { tickets } = await this.api.listTickets();
      const sorted = [...tickets].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      const changes = this.tracker?.update(sorted) ?? [];
      this.store.set({
        tickets: sorted,
        ticketsLoaded: true,
        ticketsError: null,
        unread: this.tracker?.unread(sorted) ?? {},
      });
      for (const change of changes) this.emitter.emit('status:changed', change);
      const { view, selectedId } = this.store.state;
      if (view === 'detail' && selectedId && changes.some((c) => c.ticket.id === selectedId)) void this.openTicket(selectedId);
    } catch (error) {
      this.store.set({ ticketsLoaded: true, ticketsError: errorMessage(error, 'Could not load your tickets.') });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                         */
  /* ---------------------------------------------------------------- */

  private async boot(): Promise<void> {
    const api = this.api;
    if (!api) return;
    let config: WidgetConfig;
    try {
      config = await api.getConfig();
    } catch (error) {
      if (error instanceof ApiRequestError && [401, 403, 404].includes(error.status)) {
        console.error(`[Planora] ${error.message} Check your site key and allowed domains.`);
        this.capture?.uninstall();
        return;
      }
      config = FALLBACK_CONFIG;
    }
    if (!this.initialized || this.api !== api) return; // shut down while loading
    if (!config.enabled) {
      this.capture?.uninstall();
      return;
    }

    const options = this.options!;
    config = {
      ...config,
      branding: {
        primary_color: options.primaryColor ?? config.branding.primary_color,
        launcher_label: options.launcherLabel ?? config.branding.launcher_label,
        position: options.position ?? config.branding.position,
      },
    };
    this.store.set({ config });

    await domReady();
    if (!this.initialized || this.api !== api) return;
    this.ui = this.mountUi(this, { hideLauncher: this.options?.hideLauncher, zIndex: this.options?.zIndex });
    this.updateReady();

    const onOnline = () => void this.flushOutbox();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.refreshTickets();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    this.removeListeners.push(
      () => window.removeEventListener('online', onOnline),
      () => document.removeEventListener('visibilitychange', onVisible),
    );

    this.emitter.emit('ready', undefined);
    await this.afterIdentity();
    this.schedulePolling();
  }

  private async afterIdentity(): Promise<void> {
    if (!this.store.state.ready) return;
    await this.flushOutbox();
    await this.refreshTickets();
  }

  private async flushOutbox(): Promise<void> {
    if (!this.submitter || !this.store.state.ready) return;
    await this.submitter.flush((ticket) => {
      this.tracker?.markSeen(ticket);
      this.upsertTicket(ticket);
      this.emitter.emit('ticket:created', { ticket });
    });
    this.store.set({ pendingCount: this.submitter.pendingCount() });
  }

  private setUser(user: PlanoraUser | null): void {
    this.currentUserHash = user?.userHash;
    const publicUser: WidgetUser | null = user ? { id: String(user.id), name: user.name, email: user.email } : null;
    this.store.set({ user: publicUser });
    const siteKey = this.options?.siteKey ?? 'unknown';
    this.tracker = new TicketTracker(`planora:seen:${siteKey}:${publicUser?.id ?? `anon:${this.anonymousId()}`}`);
  }

  private sessionRequest(): SessionRequest {
    const user = this.store.state.user;
    if (user) return { user, user_hash: this.currentUserHash };
    return { anonymous_id: this.anonymousId() };
  }

  private anonymousId(): string {
    const key = 'planora:anonymous-id';
    let id = storage.get<string>(key);
    if (!id) {
      id = uuid();
      storage.set(key, id);
    }
    return id;
  }

  private updateReady(): void {
    const { config, user } = this.store.state;
    const ready = Boolean(this.ui && config && config.enabled && (config.mode === 'public' || user));
    this.store.set({ ready, ...(ready ? {} : { open: false }) });
  }

  private takeSnapshot(): void {
    if (!this.capture) return;
    const exclude = this.ui?.host ?? null;
    const config = this.store.state.config ?? FALLBACK_CONFIG;
    this.snapshot = {
      context: this.capture.freeze(this.metadata, exclude),
      screenshot: config.features.screenshot ? captureScreenshot(exclude) : null,
    };
  }

  private schedulePolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (!this.initialized) return;
    const interval = this.store.state.open ? OPEN_POLL_MS : IDLE_POLL_MS;
    this.pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.refreshTickets();
    }, interval);
  }

  private upsertTicket(ticket: TicketSummary): void {
    const summary: TicketSummary = {
      id: ticket.id,
      key: ticket.key,
      type: ticket.type,
      title: ticket.title,
      status: ticket.status,
      status_label: ticket.status_label,
      created_at: ticket.created_at,
      updated_at: ticket.updated_at,
    };
    const tickets = [summary, ...this.store.state.tickets.filter((t) => t.id !== ticket.id)].sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at),
    );
    this.tracker?.update(tickets);
    this.store.set({ tickets, unread: this.tracker?.unread(tickets) ?? {} });
  }

  private revokeDraftUrl(draft: DraftState | null): void {
    if (draft?.screenshotUrl) URL.revokeObjectURL(draft.screenshotUrl);
  }
}

/** When the reporter turns off technical details, keep only where it happened. */
function stripDetails(context: CaptureContext): CaptureContext {
  return { ...context, console: [], errors: [], network: [], navigation: [], dom_snapshot: null };
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError && error.status === 0) return 'You appear to be offline. Please try again.';
  if (error instanceof ApiRequestError && error.status < 500) return error.message;
  return fallback;
}

function domReady(): Promise<void> {
  if (document.readyState !== 'loading' && document.body) return Promise.resolve();
  return new Promise((resolve) => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }));
}
