import { afterEach, expect, it } from 'vitest';
import { createBuffers, recordConsole, recordNetwork } from '../src/capture/recorders';
import { Ring } from '../src/capture/ring';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

it('ring keeps only the newest entries and returns copies', () => {
  const ring = new Ring<number>(3);
  for (let i = 1; i <= 5; i++) ring.push(i);
  const frozen = ring.snapshot();
  ring.push(6);
  expect(frozen).toEqual([3, 4, 5]);
  expect(ring.snapshot()).toEqual([4, 5, 6]);
});

it('records console output, redacted, and still calls the original', () => {
  const buffers = createBuffers();
  const original = console.warn;
  let passedThrough = false;
  console.warn = () => {
    passedThrough = true;
  };
  cleanups.push(() => (console.warn = original));
  cleanups.push(recordConsole(buffers.console));

  console.warn('Login failed', { password: 'hunter2' });
  const [entry] = buffers.console.snapshot();
  expect(entry?.level).toBe('warn');
  expect(entry?.message).toContain('Login failed');
  expect(entry?.message).not.toContain('hunter2');
  expect(passedThrough).toBe(true);
});

it('records failed fetches but ignores the Planora API and fast successes', async () => {
  const buffers = createBuffers();
  const originalFetch = window.fetch;
  window.fetch = (async (input: RequestInfo | URL) =>
    new Response('x', { status: String(input).includes('fail') ? 500 : 200 })) as typeof fetch;
  cleanups.push(() => (window.fetch = originalFetch));
  cleanups.push(recordNetwork(buffers.network, { slowMs: 3000, ignore: () => ['https://api.planora.dev'] }));

  await fetch('https://shop.test/ok');
  await fetch('https://shop.test/fail?token=abc');
  await fetch('https://api.planora.dev/widget/v1/fail');

  const entries = buffers.network.snapshot();
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ method: 'GET', status: 500, failed: false });
  expect(entries[0]?.url).toBe('https://shop.test/fail?token=[redacted]');
});

it('uninstalling restores the original functions', () => {
  const originalLog = console.log;
  const originalFetch = window.fetch;
  const buffers = createBuffers();
  const undoConsole = recordConsole(buffers.console);
  const undoNetwork = recordNetwork(buffers.network, { slowMs: 3000, ignore: () => [] });
  expect(console.log).not.toBe(originalLog);
  undoConsole();
  undoNetwork();
  expect(console.log).toBe(originalLog);
  expect(window.fetch).toBe(originalFetch);
});
