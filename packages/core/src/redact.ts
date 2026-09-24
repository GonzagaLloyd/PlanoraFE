/**
 * Redaction runs in the browser before anything leaves the page.
 * It is deliberately aggressive: a false positive costs a little debugging
 * context, a false negative leaks a customer's secret.
 */

const SENSITIVE_KEY =
  /pass(word|wd)?|pwd|secret|token|api[-_]?key|auth|session|cookie|credit|card|cvv|cvc|ssn|iban|signature|private/i;

const JWT = /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g;
const AUTH_SCHEME = /\b(bearer|basic|token)\s+[\w\-.~+/]{8,}=*/gi;
const KEY_VALUE =
  /(["']?)([\w-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|authorization|cookie|session|signature)[\w-]*)\1(\s*[:=]\s*)(["']?)((?:bearer|basic|token)\s+)?([^"'\s,&;}]+)\4/gi;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+\w/g;
const CARD_LIKE = /\b\d(?:[ -]?\d){12,18}\b/g;

export const REDACTED = '[redacted]';

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function redactText(input: string): string {
  return (
    input
      .replace(JWT, '[redacted-jwt]')
      // key=value first (keeping an auth scheme such as "Bearer"), then any bare "Bearer xyz" left over.
      .replace(
        KEY_VALUE,
        (_m, q1: string, key: string, sep: string, q2: string, scheme: string | undefined) =>
          `${q1}${key}${q1}${sep}${q2}${scheme ?? ''}${REDACTED}${q2}`,
      )
      .replace(AUTH_SCHEME, (_m, scheme: string) => `${scheme} ${REDACTED}`)
      .replace(EMAIL, '[email]')
      .replace(CARD_LIKE, '[number]')
  );
}

/** Removes credentials and sensitive query params from a URL. */
export function redactUrl(input: string, base?: string): string {
  let url: URL;
  try {
    url = new URL(input, base ?? (typeof location !== 'undefined' ? location.href : 'http://localhost'));
  } catch {
    return redactText(input);
  }
  url.username = '';
  url.password = '';
  for (const key of Array.from(url.searchParams.keys())) {
    if (isSensitiveKey(key)) url.searchParams.set(key, REDACTED);
  }
  if (url.hash && SENSITIVE_KEY.test(url.hash)) url.hash = '#[redacted]';
  // searchParams.set percent-encodes the brackets; keep the marker readable.
  return url.href.replace(/%5Bredacted%5D/g, REDACTED);
}
