/**
 * CDN entry (widget.js), loaded by loader.js. Replaces the loader's queueing
 * stub on window.Planora with the real API and replays any queued calls, so
 * `Planora('identify', …)` works even if it ran before this file arrived.
 */
import type { InitOptions, PlanoraUser } from './planora';
import type { Metadata } from './capture';
import type { PlanoraEventName } from './events';
import { Planora } from './index';

type Command =
  | ['init', InitOptions]
  | ['identify', PlanoraUser | null]
  | ['open', ('home' | 'report' | 'list')?]
  | ['close']
  | ['toggle']
  | ['shutdown']
  | ['setMetadata', Metadata]
  | ['on', PlanoraEventName, (payload: unknown) => void];

export interface PlanoraGlobal {
  (...command: Command): unknown;
  q?: ArrayLike<unknown>[];
  loaded?: boolean;
  init: typeof Planora.init;
  identify: typeof Planora.identify;
  open: typeof Planora.open;
  close: typeof Planora.close;
  toggle: typeof Planora.toggle;
  shutdown: typeof Planora.shutdown;
  setMetadata: typeof Planora.setMetadata;
  on: typeof Planora.on;
}

declare global {
  interface Window {
    Planora?: PlanoraGlobal;
  }
}

function dispatch(name: string, args: unknown[]): unknown {
  switch (name) {
    case 'init':
      return Planora.init(args[0] as InitOptions);
    case 'identify':
      return Planora.identify(args[0] as PlanoraUser | null);
    case 'open':
      return Planora.open(args[0] as 'home' | 'report' | 'list' | undefined);
    case 'close':
      return Planora.close();
    case 'toggle':
      return Planora.toggle();
    case 'shutdown':
      return Planora.shutdown();
    case 'setMetadata':
      return Planora.setMetadata(args[0] as Metadata);
    case 'on':
      return Planora.on(args[0] as PlanoraEventName, args[1] as (payload: unknown) => void);
    default:
      console.warn(`[Planora] Unknown command "${name}".`);
      return undefined;
  }
}

if (typeof window !== 'undefined' && !window.Planora?.loaded) {
  const queued = Array.from(window.Planora?.q ?? []);

  const api = ((name: string, ...args: unknown[]) => dispatch(name, args)) as unknown as PlanoraGlobal;
  api.loaded = true;
  api.init = Planora.init.bind(Planora);
  api.identify = Planora.identify.bind(Planora);
  api.open = Planora.open.bind(Planora);
  api.close = Planora.close.bind(Planora);
  api.toggle = Planora.toggle.bind(Planora);
  api.shutdown = Planora.shutdown.bind(Planora);
  api.setMetadata = Planora.setMetadata.bind(Planora);
  api.on = Planora.on.bind(Planora);
  window.Planora = api;

  // Run init first regardless of queue order, then everything else in order.
  const isInit = (call: ArrayLike<unknown>) => call[0] === 'init';
  for (const call of [...queued.filter(isInit), ...queued.filter((c) => !isInit(c))]) {
    const [name, ...args] = Array.from(call);
    dispatch(String(name), args);
  }
}
