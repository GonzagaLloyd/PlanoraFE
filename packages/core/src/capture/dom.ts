import { redactText } from '../redact';

const REMOVE_SELECTOR = 'script, noscript, template, style, iframe, object, embed, canvas, video, audio, svg';
const MASK_SELECTOR = '[data-planora-mask]';
const DEFAULT_MAX_CHARS = 250_000;

/**
 * A sanitized, size-capped copy of the page's HTML: no scripts or styles, no
 * form values, masked regions blanked, secrets redacted, the widget removed.
 */
export function snapshotDom(exclude: Element | null, maxChars = DEFAULT_MAX_CHARS): string | null {
  try {
    const clone = document.documentElement.cloneNode(true) as HTMLElement;

    if (exclude?.id) clone.querySelector(`#${CSS.escape(exclude.id)}`)?.remove();
    clone.querySelectorAll(REMOVE_SELECTOR).forEach((el) => {
      const placeholder = document.createComment(` ${el.tagName.toLowerCase()} removed `);
      el.replaceWith(placeholder);
    });

    clone.querySelectorAll('input, textarea, select').forEach((el) => {
      el.removeAttribute('value');
      if (el.tagName === 'TEXTAREA') el.textContent = '';
    });

    clone.querySelectorAll(MASK_SELECTOR).forEach((el) => {
      el.textContent = '•••';
      for (const attr of Array.from(el.attributes)) {
        if (attr.name !== 'class' && attr.name !== 'id' && attr.name !== 'data-planora-mask') el.removeAttribute(attr.name);
      }
    });

    clone.querySelectorAll('*').forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.startsWith('on') || attr.name === 'style') el.removeAttribute(attr.name);
      }
    });

    let html = redactText(clone.outerHTML);
    if (html.length > maxChars) html = `${html.slice(0, maxChars)}\n<!-- planora: snapshot truncated -->`;
    return html;
  } catch {
    return null;
  }
}
