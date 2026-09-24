import type {
  CreateTicketRequest,
  CreateTicketResponse,
  ListTicketsResponse,
  ReplyRequest,
  SessionRequest,
  SessionResponse,
  TicketDetail,
  UploadRequest,
  UploadResponse,
  WidgetConfig,
} from '@planora/widget-contract';
import { ENDPOINTS, HEADERS } from '@planora/widget-contract/constants';

// Keep a reference to the browser's fetch from before our own network
// recorder patches it, so widget traffic never shows up in reports.
const nativeFetch: typeof fetch | undefined = typeof fetch === 'function' ? fetch.bind(globalThis) : undefined;

const REQUEST_TIMEOUT_MS = 15_000;

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }

  /** Network failures, timeouts, rate limits and server errors are worth retrying. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

interface RequestOptions {
  body?: unknown;
  auth?: boolean;
  idempotencyKey?: string;
}

export class ApiClient {
  private session: SessionResponse | null = null;
  private sessionPromise: Promise<SessionResponse> | null = null;

  constructor(
    readonly baseUrl: string,
    private readonly siteKey: string,
    private readonly identity: () => SessionRequest,
  ) {}

  /** Drop the session token, e.g. after identify() changes the user. */
  resetSession(): void {
    this.session = null;
    this.sessionPromise = null;
  }

  getConfig(): Promise<WidgetConfig> {
    return this.request('GET', ENDPOINTS.config, { auth: false });
  }

  requestUploads(body: UploadRequest): Promise<UploadResponse> {
    return this.request('POST', ENDPOINTS.uploads, { body });
  }

  async putUpload(url: string, headers: Record<string, string>, blob: Blob): Promise<void> {
    const response = await this.rawFetch(url, { method: 'PUT', headers, body: blob });
    if (!response.ok) throw new ApiRequestError(response.status, 'upload_failed', `Upload failed (${response.status})`);
  }

  createTicket(body: CreateTicketRequest, idempotencyKey: string): Promise<CreateTicketResponse> {
    return this.request('POST', ENDPOINTS.tickets, { body, idempotencyKey });
  }

  listTickets(updatedSince?: string): Promise<ListTicketsResponse> {
    const query = updatedSince ? `?updated_since=${encodeURIComponent(updatedSince)}` : '';
    return this.request('GET', `${ENDPOINTS.tickets}${query}`);
  }

  getTicket(id: string): Promise<TicketDetail> {
    return this.request('GET', ENDPOINTS.ticket(id));
  }

  reply(id: string, body: ReplyRequest): Promise<TicketDetail> {
    return this.request('POST', ENDPOINTS.replies(id), { body });
  }

  private async ensureSession(): Promise<SessionResponse> {
    if (this.session && new Date(this.session.expires_at).getTime() - Date.now() > 30_000) return this.session;
    if (!this.sessionPromise) {
      this.sessionPromise = this.request<SessionResponse>('POST', ENDPOINTS.session, { body: this.identity(), auth: false })
        .then((session) => {
          this.session = session;
          return session;
        })
        .finally(() => {
          this.sessionPromise = null;
        });
    }
    return this.sessionPromise;
  }

  private async request<T>(method: string, path: string, options: RequestOptions = {}, isRetry = false): Promise<T> {
    const headers: Record<string, string> = { [HEADERS.siteKey]: this.siteKey, Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.idempotencyKey) headers[HEADERS.idempotencyKey] = options.idempotencyKey;
    if (options.auth !== false) {
      const session = await this.ensureSession();
      headers[HEADERS.authorization] = `Bearer ${session.token}`;
    }

    const response = await this.rawFetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if (response.status === 401 && options.auth !== false && !isRetry) {
      this.resetSession();
      return this.request<T>(method, path, options, true);
    }

    if (!response.ok) {
      let code = 'http_error';
      let message = `Request failed (${response.status})`;
      try {
        const data = (await response.json()) as { error?: { code?: string; message?: string } };
        code = data.error?.code ?? code;
        message = data.error?.message ?? message;
      } catch {
        /* non-JSON error body */
      }
      throw new ApiRequestError(response.status, code, message);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private async rawFetch(url: string, init: RequestInit): Promise<Response> {
    if (!nativeFetch) throw new ApiRequestError(0, 'no_fetch', 'fetch is not available in this browser');
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
      return await nativeFetch(url, { ...init, signal: controller?.signal, credentials: 'omit', mode: 'cors' });
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      throw new ApiRequestError(0, aborted ? 'timeout' : 'network', aborted ? 'The request timed out' : 'Network error');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
