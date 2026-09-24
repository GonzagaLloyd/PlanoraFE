import { describe, expect, it } from 'vitest';
import { redactText, redactUrl } from '../src/redact';

describe('redactText', () => {
  it('removes JWTs and bearer tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(redactText(`token ${jwt}`)).not.toContain(jwt);
    expect(redactText('Authorization: Bearer abcdef1234567890')).toBe('Authorization: Bearer [redacted]');
  });

  it('removes sensitive key/value pairs in JSON and query strings', () => {
    expect(redactText('{"password":"hunter2","user":"ana"}')).toBe('{"password":"[redacted]","user":"ana"}');
    expect(redactText('api_key=abc123&page=2')).toBe('api_key=[redacted]&page=2');
    expect(redactText("{ token: 'sk_live_123' }")).toBe("{ token: '[redacted]' }");
  });

  it('removes emails and card-like numbers', () => {
    expect(redactText('contact ana@example.com now')).toBe('contact [email] now');
    expect(redactText('card 4242 4242 4242 4242 ok')).toBe('card [number] ok');
  });

  it('leaves ordinary text alone', () => {
    expect(redactText('Cannot read properties of undefined (reading "price")')).toBe(
      'Cannot read properties of undefined (reading "price")',
    );
  });
});

describe('redactUrl', () => {
  it('masks sensitive query params and credentials', () => {
    const url = redactUrl('https://user:pass@shop.test/api?api_key=secret&page=2&session_id=abc');
    expect(url).toBe('https://shop.test/api?api_key=[redacted]&page=2&session_id=[redacted]');
  });

  it('resolves relative URLs against the page', () => {
    expect(redactUrl('/orders?token=x', 'https://shop.test/cart')).toBe('https://shop.test/orders?token=[redacted]');
  });
});
