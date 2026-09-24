import type { ConsoleEntry, ErrorEntry, NavigationEntry, NetworkEntry } from '@planora/widget-contract';
import { redactText, redactUrl } from '../redact';
import { nowIso, safeStringify, truncate } from '../util';
import { Ring } from './ring';

export interface CaptureBuffers {
  console: Ring<ConsoleEntry>;
  errors: Ring<ErrorEntry>;
  network: Ring<NetworkEntry>;
  navigation: Ring<NavigationEntry>;
}

export function createBuffers(): CaptureBuffers {
  return {
    console: new Ring<ConsoleEntry>(50),
    errors: new Ring<ErrorEntry>(30),
    network: new Ring<NetworkEntry>(30),
    navigation: new Ring<NavigationEntry>(20),
  };
}

type Uninstall = () => void;

const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;
const MAX_MESSAGE = 1000;

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  return safeStringify(arg);
}

/* ------------------------------------------------------------------ */
/* console.*                                                           */
/* ------------------------------------------------------------------ */

export function recordConsole(ring: Ring<ConsoleEntry>): Uninstall {
  const originals = new Map<string, (...args: unknown[]) => void>();
  let reentrant = false;

  for (const level of CONSOLE_LEVELS) {
    const original = console[level] as (...args: unknown[]) => void;
    if (typeof original !== 'function') continue;
    originals.set(level, original);
    console[level] = function patched(this: Console, ...args: unknown[]) {
      if (!reentrant) {
        reentrant = true;
        try {
          const message = truncate(redactText(args.map(formatArg).join(' ')), MAX_MESSAGE);
          ring.push({ level, message, at: nowIso() });
        } catch {
          /* never break the host's logging */
        } finally {
          reentrant = false;
        }
      }
      return original.apply(this, args);
    };
  }

  return () => {
    for (const [level, original] of originals) {
      (console as unknown as Record<string, unknown>)[level] = original;
    }
  };
}

/* ------------------------------------------------------------------ */
/* window errors + unhandled rejections                                */
/* ------------------------------------------------------------------ */

export function recordErrors(ring: Ring<ErrorEntry>): Uninstall {
  const onError = (event: Event) => {
    try {
      const target = event.target as (Element & { src?: string; href?: string }) | null;
      // Resource load failures (img, script, link) bubble to window in the capture phase.
      if (target && target !== (window as unknown) && target instanceof Element) {
        const src = target.src || target.href || '';
        ring.push({
          kind: 'error',
          message: `Failed to load ${target.tagName.toLowerCase()}: ${redactUrl(src)}`,
          at: nowIso(),
        });
        return;
      }
      const errorEvent = event as ErrorEvent;
      const err = errorEvent.error as unknown;
      ring.push({
        kind: 'error',
        message: truncate(redactText(errorEvent.message || (err instanceof Error ? err.message : String(err))), MAX_MESSAGE),
        stack: err instanceof Error && err.stack ? truncate(redactText(err.stack), 4000) : undefined,
        source: errorEvent.filename ? `${redactUrl(errorEvent.filename)}:${errorEvent.lineno}:${errorEvent.colno}` : undefined,
        at: nowIso(),
      });
    } catch {
      /* ignore */
    }
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    try {
      const reason = event.reason as unknown;
      ring.push({
        kind: 'unhandledrejection',
        message: truncate(redactText(reason instanceof Error ? `${reason.name}: ${reason.message}` : formatArg(reason)), MAX_MESSAGE),
        stack: reason instanceof Error && reason.stack ? truncate(redactText(reason.stack), 4000) : undefined,
        at: nowIso(),
      });
    } catch {
      /* ignore */
    }
  };

  window.addEventListener('error', onError, true);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError, true);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

/* ------------------------------------------------------------------ */
/* fetch + XMLHttpRequest                                              */
/* ------------------------------------------------------------------ */

export interface NetworkOptions {
  /** Requests slower than this are recorded even when they succeed. */
  slowMs: number;
  /** URLs (prefixes) that must never be recorded, e.g. the Planora API itself. */
  ignore: () => string[];
}

export function recordNetwork(ring: Ring<NetworkEntry>, options: NetworkOptions): Uninstall {
  const shouldIgnore = (url: string) => options.ignore().some((prefix) => prefix && url.startsWith(prefix));

  const record = (method: string, url: string, status: number, failed: boolean, started: number) => {
    const duration = Math.round(performance.now() - started);
    if (!failed && status < 400 && duration < options.slowMs) return;
    ring.push({ method: method.toUpperCase(), url: redactUrl(url), status, failed, duration_ms: duration, at: nowIso() });
  };

  const uninstalls: Uninstall[] = [];

  // fetch
  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    const patchedFetch: typeof window.fetch = function (input, init) {
      let url = '';
      let method = 'GET';
      try {
        if (typeof input === 'string') url = input;
        else if (input instanceof URL) url = input.href;
        else {
          url = input.url;
          method = input.method;
        }
        if (init?.method) method = init.method;
        url = new URL(url, location.href).href;
      } catch {
        /* keep raw values */
      }
      if (shouldIgnore(url)) return originalFetch.call(window, input, init);
      const started = performance.now();
      return originalFetch.call(window, input, init).then(
        (response) => {
          record(method, url, response.status, false, started);
          return response;
        },
        (error: unknown) => {
          record(method, url, 0, true, started);
          throw error;
        },
      );
    };
    window.fetch = patchedFetch;
    uninstalls.push(() => {
      if (window.fetch === patchedFetch) window.fetch = originalFetch;
    });
  }

  // XMLHttpRequest
  if (typeof XMLHttpRequest !== 'undefined') {
    const proto = XMLHttpRequest.prototype;
    const originalOpen = proto.open;
    const originalSend = proto.send;
    const meta = new WeakMap<XMLHttpRequest, { method: string; url: string }>();

    proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      try {
        meta.set(this, { method, url: new URL(String(url), location.href).href });
      } catch {
        meta.set(this, { method, url: String(url) });
      }
      return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof proto.open;

    proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      const info = meta.get(this);
      if (info && !shouldIgnore(info.url)) {
        const started = performance.now();
        this.addEventListener('loadend', () => {
          record(info.method, info.url, this.status, this.status === 0, started);
        });
      }
      return originalSend.call(this, body);
    };

    uninstalls.push(() => {
      proto.open = originalOpen;
      proto.send = originalSend;
    });
  }

  return () => uninstalls.forEach((fn) => fn());
}

/* ------------------------------------------------------------------ */
/* SPA navigation                                                      */
/* ------------------------------------------------------------------ */

export function recordNavigation(ring: Ring<NavigationEntry>): Uninstall {
  let last = '';
  const push = () => {
    const url = redactUrl(location.href);
    if (url === last) return;
    last = url;
    ring.push({ url, at: nowIso() });
  };
  push();

  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  history.pushState = function (this: History, ...args: Parameters<History['pushState']>) {
    const result = originalPush.apply(this, args);
    push();
    return result;
  };
  history.replaceState = function (this: History, ...args: Parameters<History['replaceState']>) {
    const result = originalReplace.apply(this, args);
    push();
    return result;
  };
  window.addEventListener('popstate', push);
  window.addEventListener('hashchange', push);

  return () => {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
    window.removeEventListener('popstate', push);
    window.removeEventListener('hashchange', push);
  };
}
