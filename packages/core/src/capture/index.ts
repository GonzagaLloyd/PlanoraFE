import type { CaptureContext } from '@planora/widget-contract';
import { redactUrl } from '../redact';
import { SDK_NAME, SDK_VERSION } from '../version';
import { nowIso } from '../util';
import { snapshotDom } from './dom';
import { type CaptureBuffers, createBuffers, recordConsole, recordErrors, recordNavigation, recordNetwork } from './recorders';

export type Metadata = Record<string, string | number | boolean | null>;

export interface CaptureOptions {
  /** URL prefixes never recorded (the Planora API). */
  ignoreUrls: () => string[];
  slowRequestMs?: number;
  console?: boolean;
  network?: boolean;
}

/**
 * Passive recorder. Installed at load so it sees what happened *before* the
 * reporter opened the bubble; `freeze()` copies the buffers at open time.
 */
export class Capture {
  readonly buffers: CaptureBuffers = createBuffers();
  private uninstalls: Array<() => void> = [];
  private installed = false;

  constructor(private readonly options: CaptureOptions) {}

  install(): void {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;
    if (this.options.console !== false) this.uninstalls.push(recordConsole(this.buffers.console));
    this.uninstalls.push(recordErrors(this.buffers.errors));
    if (this.options.network !== false) {
      this.uninstalls.push(
        recordNetwork(this.buffers.network, { slowMs: this.options.slowRequestMs ?? 3000, ignore: this.options.ignoreUrls }),
      );
    }
    this.uninstalls.push(recordNavigation(this.buffers.navigation));
  }

  uninstall(): void {
    this.uninstalls.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    });
    this.uninstalls = [];
    this.installed = false;
  }

  /** Copy of everything recorded so far plus page/environment facts. */
  freeze(metadata: Metadata, exclude: Element | null): CaptureContext {
    let timezone = '';
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      /* ignore */
    }
    return {
      page_url: redactUrl(location.href),
      page_title: document.title.slice(0, 300),
      referrer: document.referrer ? redactUrl(document.referrer) : '',
      user_agent: navigator.userAgent,
      language: navigator.language,
      timezone,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      screen: { width: window.screen.width, height: window.screen.height, pixel_ratio: window.devicePixelRatio || 1 },
      captured_at: nowIso(),
      console: this.buffers.console.snapshot(),
      errors: this.buffers.errors.snapshot(),
      network: this.buffers.network.snapshot(),
      navigation: this.buffers.navigation.snapshot(),
      dom_snapshot: snapshotDom(exclude),
      metadata: { ...metadata },
      sdk: { name: SDK_NAME, version: SDK_VERSION },
    };
  }
}

export { captureScreenshot } from './screenshot';
