import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const API = 'http://localhost:8787';
const SHOTS = 'test-results/screens';

/** Writes a page into the playground's public folder (served by Vite) and opens it. */
async function openGeneratedPage(page: Page, name: string, head: string) {
  mkdirSync('apps/playground/public/generated', { recursive: true });
  writeFileSync(`apps/playground/public/generated/${name}`, `<!doctype html><html><head>${head}</head><body><h1>Generated page</h1></body></html>`);
  // Vite's file watcher picks new public files up asynchronously.
  await expect.poll(async () => (await page.request.get(`/generated/${name}`)).status(), { timeout: 10_000 }).toBe(200);
  await page.goto(`/generated/${name}`);
}

interface OpsTicket {
  id: string;
  key: string;
  status: string;
  title: string;
  screenshotId: string | null;
  attachmentIds: string[];
  reporter: { user: { id: string } | null; anonymousId: string | null };
  context: {
    page_url: string;
    console: Array<{ level: string; message: string }>;
    errors: Array<{ message: string }>;
    network: Array<{ url: string; status: number; failed: boolean }>;
    navigation: Array<{ url: string }>;
    metadata: Record<string, unknown>;
    dom_snapshot: string | null;
  } | null;
}

async function opsState(page: Page): Promise<{ tickets: OpsTicket[] }> {
  const res = await page.request.get(`${API}/__ops/state`);
  return (await res.json()) as { tickets: OpsTicket[] };
}

async function transition(page: Page, id: string, body: Record<string, unknown>) {
  const res = await page.request.post(`${API}/__ops/tickets/${id}/transition`, { data: body });
  expect(res.ok()).toBeTruthy();
}

const launcher = (page: Page) => page.locator('#planora-widget .pl-launcher');
const panel = (page: Page) => page.locator('#planora-widget .pl-panel');

async function fileReport(page: Page, title: string, description: string) {
  await launcher(page).click();
  await panel(page).getByRole('button', { name: /Report a bug/ }).click();
  await panel(page).getByLabel('Short summary').fill(title);
  await panel(page).getByLabel('What happened?').fill(description);
  await panel(page).getByRole('button', { name: 'Review' }).click();
  await panel(page).getByRole('button', { name: 'Send report' }).click();
}

test.beforeEach(async ({ request }) => {
  await request.post(`${API}/__ops/reset`);
  await request.post(`${API}/__ops/chaos`, { data: { enabled: false } });
});

test('script-tag install: captures context, redacts secrets, files a ticket', async ({ page }) => {
  await page.goto('/plain.html');
  await expect(launcher(page)).toBeVisible();

  // Trouble before the bubble is opened.
  await page.click('#throw');
  await page.click('#console');
  await page.click('#fetch404');
  await page.click('#navigate');
  await page.waitForTimeout(500);

  await launcher(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByText('How can we help?')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-home.png` });

  await panel(page).getByRole('button', { name: /Report a bug/ }).click();
  // Validation
  await panel(page).getByRole('button', { name: 'Review' }).click();
  await expect(panel(page).getByText('Please add a short summary')).toBeVisible();

  await panel(page).getByLabel('Short summary').fill('Checkout button does nothing');
  await panel(page).getByLabel('What happened?').fill('I click "Place order" and nothing happens. Expected the confirmation page.');
  await expect(panel(page).locator('.pl-shot img')).toBeVisible({ timeout: 8000 });
  await expect(panel(page).getByText(/errors?/).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/02-report.png` });

  await panel(page).getByRole('button', { name: 'Review' }).click();
  await expect(panel(page).getByText('Checkout button does nothing')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-review.png` });

  await panel(page).getByRole('button', { name: 'Send report' }).click();
  await expect(panel(page).getByRole('heading', { name: 'Report sent' })).toBeVisible();
  await expect(panel(page).getByText(/PLN-\d+ is now in To Do/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-sent.png` });

  const { tickets } = await opsState(page);
  expect(tickets).toHaveLength(1);
  const ticket = tickets[0]!;
  expect(ticket.status).toBe('to_do');
  expect(ticket.reporter.user?.id).toBe('user_42');
  expect(ticket.screenshotId).toBeTruthy();

  const ctx = ticket.context!;
  expect(ctx.metadata).toMatchObject({ appVersion: '2.3.1', plan: 'pro' });
  expect(ctx.errors.some((e) => e.message.includes('reading "price"'))).toBe(true);
  // Redaction: the token in the console message and the api_key query param are gone.
  const consoleText = JSON.stringify(ctx.console);
  expect(consoleText).toContain('Checkout failed');
  expect(consoleText).not.toContain('sk_live_should_be_redacted');
  const failed = ctx.network.find((n) => n.url.includes('/api/orders/1042'));
  expect(failed?.status).toBe(404);
  expect(failed?.url).toContain('api_key=[redacted]');
  expect(failed?.url).not.toContain('secret123');
  // Widget's own API calls are never recorded.
  expect(ctx.network.some((n) => n.url.startsWith(API))).toBe(false);
  expect(ctx.navigation.some((n) => n.url.includes('step='))).toBe(true);
});

test('page snapshot strips form values and masked regions', async ({ page }) => {
  await page.goto('/plain.html');
  await fileReport(page, 'Snapshot check', 'Checking the DOM snapshot.');
  await expect(panel(page).getByRole('heading', { name: 'Report sent' })).toBeVisible();
  const [ticket] = (await opsState(page)).tickets;
  const res = await page.request.get(`${API}/__ops/tickets/${ticket!.id}/snapshot`);
  expect(res.ok()).toBeTruthy();
  const snapshot = await res.text();
  expect(snapshot).toContain('Autumn collection'); // page content is there…
  expect(snapshot).not.toContain('hunter2'); // …form values are not
  expect(snapshot).not.toContain('4242'); // …masked regions are blanked
  expect(snapshot).toContain('•••');
  expect(snapshot).not.toContain('ana@example.com');
  expect(snapshot).not.toContain('planora-widget'); // the widget itself is excluded
  expect(snapshot).not.toMatch(/<script[\s>]/);
});

test('status updates: blocked → reply → shipped, with unread badge', async ({ page }) => {
  await page.goto('/plain.html');
  await fileReport(page, 'Export orders to CSV', 'Need a CSV export on the orders page.');
  await expect(panel(page).getByRole('heading', { name: 'Report sent' })).toBeVisible();
  await panel(page).getByRole('button', { name: 'Done' }).click();

  const [ticket] = (await opsState(page)).tickets;
  await transition(page, ticket!.id, { status: 'in_progress' });
  await transition(page, ticket!.id, { status: 'blocked', blockers: ['Which columns should the CSV include?'] });

  // A reload triggers a refresh; the badge shows the unread update.
  await page.reload();
  await expect(page.locator('#planora-widget .pl-badge')).toHaveText('1', { timeout: 10_000 });
  await page.screenshot({ path: `${SHOTS}/05-badge.png` });

  await launcher(page).click();
  await panel(page).locator('.pl-ticket').first().click();
  await expect(panel(page).getByText('We need your help')).toBeVisible();
  await expect(panel(page).getByText('Which columns should the CSV include?')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/06-blocked.png` });

  await panel(page).getByPlaceholder('Type your answer…').fill('Order number, date, customer, total.');
  await panel(page).getByRole('button', { name: 'Send reply' }).click();
  await expect(panel(page).locator('.pl-detail-head .pl-chip')).toHaveText('In Progress');
  await expect(page.locator('#planora-widget .pl-badge')).toHaveCount(0);

  await transition(page, ticket!.id, {
    status: 'shipped',
    summary: 'Added an "Export CSV" button to the orders page with the four columns you asked for.',
    pull_request_url: 'https://github.com/acme/shop/pull/42',
  });
  await panel(page).getByRole('button', { name: 'Back' }).click();
  await page.evaluate(() => (window as unknown as { Planora: (c: string) => void }).Planora('close'));
  await page.evaluate(() => (window as unknown as { Planora: (c: string) => void }).Planora('open'));
  await panel(page).locator('.pl-ticket').first().click();
  await expect(panel(page).locator('.pl-card-shipped')).toContainText('Export CSV');
  await expect(panel(page).getByRole('link', { name: 'View pull request' })).toHaveAttribute('href', 'https://github.com/acme/shop/pull/42');
  await page.screenshot({ path: `${SHOTS}/07-shipped.png` });
});

test('offline: report is queued, then sent after reload', async ({ page, request }) => {
  await page.goto('/plain.html');
  await expect(launcher(page)).toBeVisible();
  await request.post(`${API}/__ops/chaos`, { data: { enabled: true } });

  await fileReport(page, 'Queued while offline', 'This should be saved and sent later.');
  await expect(panel(page).getByRole('heading', { name: 'Saved for later' })).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/08-queued.png` });
  expect((await opsState(page)).tickets).toHaveLength(0);

  await request.post(`${API}/__ops/chaos`, { data: { enabled: false } });
  await page.reload();
  await expect.poll(async () => (await opsState(page)).tickets.length, { timeout: 10_000 }).toBe(1);
  expect((await opsState(page)).tickets[0]!.title).toBe('Queued while offline');
});

test('public mode: anonymous visitor, custom branding on the left', async ({ page }) => {
  await page.goto('/public.html');
  const button = launcher(page);
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box!.x).toBeLessThan(200);
  await expect(button).toHaveCSS('background-color', 'rgb(15, 118, 110)');

  await fileReport(page, 'Typo on the homepage', 'The banner says "Autum" instead of "Autumn".');
  await expect(panel(page).getByRole('heading', { name: 'Report sent' })).toBeVisible();
  const [ticket] = (await opsState(page)).tickets;
  expect(ticket!.reporter.user).toBeNull();
  expect(ticket!.reporter.anonymousId).toBeTruthy();
});

test('React: team mode hides the bubble when logged out and isolates users', async ({ page }) => {
  await page.goto('/react.html');
  await expect(launcher(page)).toBeVisible();
  await fileReport(page, 'Ana ticket', 'Filed by Ana.');
  await expect(panel(page).getByRole('heading', { name: 'Report sent' })).toBeVisible();
  await expect(page.getByText(/Created PLN-\d+: Ana ticket/)).toBeVisible();
  await panel(page).getByRole('button', { name: 'Done' }).click();

  await page.getByLabel('Current user').selectOption('');
  await expect(launcher(page)).toHaveCount(0);

  await page.getByLabel('Current user').selectOption('ben');
  await expect(launcher(page)).toBeVisible();
  await page.getByRole('button', { name: 'My tickets' }).click();
  await expect(panel(page).getByText('No tickets yet')).toBeVisible();

  await page.getByLabel('Current user').selectOption('ana');
  await page.getByRole('button', { name: 'My tickets' }).click();
  await expect(panel(page).getByText('Ana ticket')).toBeVisible();
});

test('hostile CSS does not leak into the widget', async ({ page }) => {
  await page.goto('/hostile.html');
  await launcher(page).click();
  const heading = panel(page).locator('.pl-hello strong');
  await expect(heading).toBeVisible();
  const style = await heading.evaluate((el) => {
    const s = getComputedStyle(el);
    return { font: s.fontFamily, spacing: s.letterSpacing, transform: s.textTransform };
  });
  expect(style.font).not.toContain('Comic Sans');
  expect(style.spacing).toBe('normal');
  expect(style.transform).toBe('none');
  await expect(launcher(page)).toHaveCSS('background-color', 'rgb(124, 58, 237)');
  await expect(launcher(page).locator('svg')).toBeVisible();
  // Widget sits above the page's z-index: 999999 banner.
  const hit = await page.evaluate(() => {
    const host = document.getElementById('planora-widget')!;
    const btn = host.shadowRoot!.querySelector('.pl-launcher')!.getBoundingClientRect();
    const el = document.elementFromPoint(btn.x + btn.width / 2, btn.y + btn.height / 2);
    return el === host;
  });
  expect(hit).toBe(true);
  await page.screenshot({ path: `${SHOTS}/09-hostile.png` });
});

test('Laravel package output works, and a signed user hash is required', async ({ page }) => {
  // Render the widget tags exactly as the Composer package would.
  const render = (user: string) =>
    execFileSync('php', [
      '-r',
      `require 'integrations/laravel/src/WidgetRenderer.php';
       $r = new Planora\\LaravelWidget\\WidgetRenderer(['site_key' => 'pk_test_secure', 'secret' => getenv('SECRET'),
         'api_base' => 'http://localhost:8787', 'cdn_url' => 'http://localhost:8787/cdn']);
       echo $r->render(${user});`,
    ], { env: { ...process.env, SECRET: 'sk_test_secure' } }).toString();

  await openGeneratedPage(page, 'laravel.html', render(`['id' => 'user_42', 'name' => 'Ana Reyes']`));
  await fileReport(page, 'Filed from Laravel', 'Server-rendered install.');
  await expect(panel(page).getByRole('heading', { name: 'Report sent' })).toBeVisible();
  expect((await opsState(page)).tickets[0]!.reporter.user?.id).toBe('user_42');
});

test('forged user hash is rejected', async ({ page }) => {
  await openGeneratedPage(
    page,
    'forged.html',
    `
        <script src="http://localhost:8787/cdn/loader.js" data-site-key="pk_test_secure" data-api-base="http://localhost:8787" async></script>
        <script>window.Planora=window.Planora||function(){(window.Planora.q=window.Planora.q||[]).push(arguments)};
        Planora('identify', { id: 'user_42', userHash: 'forged' });</script>`,
  );
  await launcher(page).click();
  await panel(page).getByRole('button', { name: /Report a bug/ }).click();
  await panel(page).getByLabel('Short summary').fill('Pretending to be someone');
  await panel(page).getByLabel('What happened?').fill('Should be refused.');
  await panel(page).getByRole('button', { name: 'Review' }).click();
  await panel(page).getByRole('button', { name: 'Send report' }).click();
  await expect(panel(page).getByRole('alert')).toContainText('user hash does not match');
  expect((await opsState(page)).tickets).toHaveLength(0);
});

/** Offset between the centre of each choice icon and the centre of its box, in px. */
async function iconCentreOffsets(page: Page) {
  return panel(page)
    .locator('.pl-choice-icon')
    .evaluateAll((boxes) =>
      boxes.map((box) => {
        const b = box.getBoundingClientRect();
        const s = box.querySelector('svg')!.getBoundingClientRect();
        return Math.max(Math.abs(b.x + b.width / 2 - (s.x + s.width / 2)), Math.abs(b.y + b.height / 2 - (s.y + s.height / 2)));
      }),
    );
}

test('home choices: icons are centred in their boxes', async ({ page }) => {
  await page.goto('/hostile.html');
  await launcher(page).click();
  const offsets = await iconCentreOffsets(page);
  expect(offsets).toHaveLength(2);
  for (const offset of offsets) expect(offset).toBeLessThanOrEqual(0.5);
  await panel(page).locator('.pl-choices').screenshot({ path: `${SHOTS}/10-choices.png` });
});

test.describe('phone layout', () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

  test('panel is a full-width bottom sheet and the launcher gets out of the way', async ({ page }) => {
    await page.goto('/plain.html');
    await expect(launcher(page)).toBeVisible();
    await launcher(page).click();

    const box = (await panel(page).boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBe(375);
    expect(Math.round(box.y + box.height)).toBe(667);
    await expect(launcher(page)).toBeHidden();

    for (const offset of await iconCentreOffsets(page)) expect(offset).toBeLessThanOrEqual(0.5);
    await page.screenshot({ path: `${SHOTS}/11-mobile-home.png` });

    // No sideways scrolling inside the panel on any screen.
    const overflows = () => panel(page).evaluate((el) => {
      const body = el.querySelector('.pl-body')!;
      return body.scrollWidth - body.clientWidth;
    });
    expect(await overflows()).toBeLessThanOrEqual(0);

    await panel(page).getByRole('button', { name: /Report a bug/ }).click();
    expect(await overflows()).toBeLessThanOrEqual(0);
    await expect(panel(page).getByLabel('Short summary')).toHaveCSS('font-size', '16px');
    await page.screenshot({ path: `${SHOTS}/12-mobile-report.png` });

    await panel(page).getByRole('button', { name: 'Close' }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(launcher(page)).toBeVisible();

    // Tapping the dimmed page above the sheet closes it too.
    await launcher(page).click();
    await expect(page.locator('#planora-widget .pl-backdrop')).toBeVisible();
    await page.mouse.click(187, 10);
    await expect(panel(page)).toHaveCount(0);
  });
});

test('disabled site key: nothing renders', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => {
    const s = document.createElement('script');
    s.src = 'http://localhost:8787/cdn/loader.js';
    s.dataset.siteKey = 'pk_test_disabled';
    s.dataset.apiBase = 'http://localhost:8787';
    document.head.appendChild(s);
  });
  await page.waitForTimeout(1500);
  await expect(page.locator('#planora-widget')).toHaveCount(0);
});
