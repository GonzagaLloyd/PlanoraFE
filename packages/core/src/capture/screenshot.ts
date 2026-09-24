import { withTimeout } from '../util';

const MASK_CSS = '[data-planora-mask], input[type="password"] { filter: blur(8px) !important; }';

/**
 * Screenshot of the visible viewport, with the widget excluded and masked
 * regions blurred. The library is loaded on first use (separate chunk) and the
 * whole capture is time-boxed: a page with an exotic canvas must never block a
 * report, so on any failure we return null and the report goes without one.
 */
export async function captureScreenshot(exclude: Element | null, timeoutMs = 3000): Promise<Blob | null> {
  const started = performance.now();
  let maskStyle: HTMLStyleElement | null = null;
  try {
    const { domToBlob } = await withTimeout(import('modern-screenshot'), timeoutMs);
    const remaining = Math.max(500, timeoutMs - (performance.now() - started));

    maskStyle = document.createElement('style');
    maskStyle.setAttribute('data-planora', 'mask');
    maskStyle.textContent = MASK_CSS;
    document.head.appendChild(maskStyle);

    const width = window.innerWidth;
    const height = window.innerHeight;
    const background = getComputedStyle(document.body).backgroundColor;

    const blob = await withTimeout(
      domToBlob(document.documentElement, {
        width,
        height,
        scale: Math.min(window.devicePixelRatio || 1, 2),
        type: 'image/jpeg',
        quality: 0.85,
        backgroundColor: background && background !== 'rgba(0, 0, 0, 0)' ? background : '#ffffff',
        filter: (node) => node !== exclude,
        style: { transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)` } as Partial<CSSStyleDeclaration>,
        timeout: remaining,
      }),
      remaining,
    );
    return blob && blob.size > 0 ? blob : null;
  } catch {
    return null;
  } finally {
    maskStyle?.remove();
  }
}
