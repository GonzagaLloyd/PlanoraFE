import type { CaptureContext, TicketDetail, TicketSummary, TicketType, WidgetConfig, WidgetUser } from '@planora/widget-contract';
import type { SubmitResult } from '../transport/submit';

export type View = 'home' | 'report' | 'review' | 'sent' | 'list' | 'detail';

export interface DraftState {
  id: string;
  type: TicketType;
  title: string;
  description: string;
  attachments: File[];
  includeScreenshot: boolean;
  includeDetails: boolean;
  screenshot: Blob | null;
  screenshotUrl: string | null;
  screenshotStatus: 'capturing' | 'ready' | 'unavailable';
  context: CaptureContext | null;
}

export interface WidgetState {
  /** Config loaded and the launcher may be shown. */
  ready: boolean;
  open: boolean;
  view: View;
  config: WidgetConfig | null;
  user: WidgetUser | null;
  draft: DraftState | null;
  submitting: boolean;
  submitError: string | null;
  lastResult: SubmitResult | null;
  tickets: TicketSummary[];
  ticketsLoaded: boolean;
  ticketsError: string | null;
  selectedId: string | null;
  detail: TicketDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  replying: boolean;
  unread: Record<string, true>;
  pendingCount: number;
}

export const initialState: WidgetState = {
  ready: false,
  open: false,
  view: 'home',
  config: null,
  user: null,
  draft: null,
  submitting: false,
  submitError: null,
  lastResult: null,
  tickets: [],
  ticketsLoaded: false,
  ticketsError: null,
  selectedId: null,
  detail: null,
  detailLoading: false,
  detailError: null,
  replying: false,
  unread: {},
  pendingCount: 0,
};

type Listener<T> = (state: T) => void;

/** Minimal observable store; the Preact UI subscribes to it. */
export class Store<T extends object> {
  private listeners = new Set<Listener<T>>();

  constructor(private current: T) {}

  get state(): T {
    return this.current;
  }

  set(patch: Partial<T> | ((state: T) => Partial<T>)): void {
    const next = typeof patch === 'function' ? patch(this.current) : patch;
    this.current = { ...this.current, ...next };
    this.listeners.forEach((listener) => listener(this.current));
  }

  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
