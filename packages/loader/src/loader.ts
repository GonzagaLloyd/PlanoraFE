/**
 * Planora script-tag loader (~1 KB). Usage:
 *
 *   <script src="https://cdn.planora.dev/widget/v1/loader.js"
 *           data-site-key="pk_live_xxx" async></script>
 *
 * It installs a queueing stub on window.Planora, calls init with the
 * data-* attributes, then loads widget.js (an ES module next to this file).
 * Calls made before widget.js arrives are queued and replayed.
 *
 * Optional attributes: data-api-base, data-position ("bottom-left"),
 * data-color ("#0f766e"), data-label, data-hide-launcher, data-src (widget URL).
 */
type Stub = ((...args: unknown[]) => void) & { q?: unknown[][]; loaded?: boolean };

(function () {
  const w = window as unknown as { Planora?: Stub };
  const script = document.currentScript as HTMLScriptElement | null;

  if (!w.Planora) {
    const stub: Stub = function (...args: unknown[]) {
      (stub.q = stub.q || []).push(args);
    };
    w.Planora = stub;
  }
  if (!script || w.Planora.loaded) return;

  const attr = (name: string) => script.getAttribute(`data-${name}`);
  const siteKey = attr('site-key');
  if (siteKey) {
    const options: Record<string, unknown> = { siteKey };
    const apiBase = attr('api-base');
    const position = attr('position');
    const color = attr('color');
    const label = attr('label');
    if (apiBase) options.apiBase = apiBase;
    if (position === 'bottom-left' || position === 'bottom-right') options.position = position;
    if (color) options.primaryColor = color;
    if (label) options.launcherLabel = label;
    if (script.hasAttribute('data-hide-launcher')) options.hideLauncher = true;
    w.Planora('init', options);
  } else {
    console.error('[Planora] Add data-site-key to the loader script tag.');
  }

  const src = attr('src') || script.src.replace(/loader(\.min)?\.js(\?.*)?$/, 'widget.js');
  const el = document.createElement('script');
  el.type = 'module';
  el.src = src;
  el.async = true;
  el.crossOrigin = 'anonymous';
  (document.head || document.documentElement).appendChild(el);
})();
