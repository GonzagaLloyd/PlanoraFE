# Planora widget

A floating "report a bug / request a feature" bubble that installs on **any website, whatever its stack**. It files tickets into Planora as **To Do** and shows the reporter how their ticket is going: In Progress, Blocked (with the reasons, and a way to reply), In Review, and Shipped (with a summary of the fix).

This repo is the **customer layer only**. Everything after To Do (the AI worker, GitHub, reviews) belongs to the Planora API. Until that API is connected, the widget runs against the mock API in `packages/mock-api`.

## Quick start

```bash
npm install
npm run dev
```

- **Playground:** http://localhost:5173. Demo sites install the widget four different ways.
- **Mock ops page:** http://localhost:8787. Plays the part of the Planora team: move tickets to Blocked or Shipped and watch the widget update.

> Port 8787 is used because 4318 is reserved by Hyper-V on some Windows machines. Change it with `PORT=…`.

## Installing on a site

The widget is one JavaScript core. Each install method is a thin wrapper that puts it on the page.

**Any site (plain HTML, WordPress, Django, Rails, .NET, static):**

```html
<script src="https://cdn.planora.dev/widget/v1/loader.js" data-site-key="pk_live_xxx" async></script>
<script>
  window.Planora = window.Planora || function () { (Planora.q = Planora.q || []).push(arguments) };
  Planora('identify', { id: '42', name: 'Ana', email: 'ana@client.com', userHash: '<hmac from your server>' });
</script>
```

Optional loader attributes: `data-api-base`, `data-position="bottom-left"`, `data-color="#0f766e"`, `data-label`, `data-hide-launcher`.

**npm (any bundler):**

```ts
import { Planora } from '@planora/widget';
Planora.init({ siteKey: 'pk_live_xxx', user: { id: '42', name: 'Ana', userHash } });
```

**React / Next.js:**

```tsx
import { PlanoraWidget, usePlanora } from '@planora/widget-react';
<PlanoraWidget siteKey="pk_live_xxx" user={{ id, name, email, userHash }} />
```

**Laravel (Composer):** see [integrations/laravel](integrations/laravel/README.md). Add `@planoraWidget` to your layout; the user hash is signed on the server automatically.

### User hash

In team mode the bubble appears only for an identified user. `userHash` is `HMAC-SHA256(user.id, site secret)` in hex, computed **on your server**. It stops anyone from pretending to be another user to read their tickets. The secret must never reach the browser.

```php
hash_hmac('sha256', (string) $user->id, env('PLANORA_SECRET'));
```
```js
crypto.createHmac('sha256', process.env.PLANORA_SECRET).update(String(user.id)).digest('hex');
```
```python
hmac.new(PLANORA_SECRET.encode(), str(user.id).encode(), hashlib.sha256).hexdigest()
```

### JavaScript API

| Call | Does |
|---|---|
| `init(options)` | Start the widget (the script tag does this for you) |
| `identify(user \| null)` | Set or clear the logged-in user |
| `open('home' \| 'report' \| 'list')`, `close()`, `toggle()` | Control the panel, e.g. from your own "Report a problem" menu item |
| `setMetadata({ appVersion, tenant })` | Extra context attached to every report |
| `on('ticket:created' \| 'status:changed' \| 'ticket:queued' \| 'open' \| 'close' \| 'ready', fn)` | Events; returns an unsubscribe function |
| `shutdown()` | Remove the widget and restore everything it patched |

With the script tag, call these as `Planora('open', 'report')`, or as `Planora.open('report')` once loaded.

### Privacy controls for the site owner

- Add `data-planora-mask` to any element to blur it in screenshots and blank it in the page snapshot. Password fields are always masked.
- Before anything leaves the browser, form values, tokens, auth headers, cookies, emails and card-like numbers are removed from logs, URLs and the page snapshot.
- The reporter can untick the screenshot and the technical details before sending.
- `captureConsole: false` and `captureNetwork: false` turn those recorders off.

### Content Security Policy

Sites with a strict CSP need to allow `script-src https://cdn.planora.dev`, `connect-src https://api.planora.dev` and `img-src data: blob:`. Installing from npm removes the need for the `script-src` entry.

## Repository layout

```
packages/
  contract/   @planora/widget-contract – zod schemas + types for /widget/v1, shared with the Planora API
  core/       @planora/widget          – capture, redaction, transport, offline queue, Preact UI in a shadow root
  loader/     loader.js                – ~0.5 KB script-tag loader; queues calls until the core arrives
  react/      @planora/widget-react    – <PlanoraWidget/> and usePlanora()
  mock-api/   fake Planora API + ops page + acts as the CDN (/cdn/loader.js, /cdn/widget.js)
integrations/
  laravel/    planora/laravel-widget   – @planoraWidget Blade directive, server-side user hash
apps/
  playground/ demo sites: plain HTML, React, hostile CSS, public mode
e2e/          Playwright tests that drive the real widget
```

## How it works

1. **Load:** `loader.js` (0.5 KB) queues calls and loads `widget.js`. The core (24 KB gzipped) starts recording console output, errors, failed or slow requests and route changes into small fixed-size buffers, so errors from *before* the reporter clicked are included.
2. **Open:** the buffers and page URL are frozen, and a screenshot of the viewport is taken in the background. The screenshot library (10 KB) loads only now, and capture gives up after 3 seconds rather than blocking.
3. **Report:** bug or feature, summary, description and images (you can paste them), then a review screen. Nothing is sent before the reporter confirms.
4. **Send:** secrets are removed, files go to presigned upload URLs, then the ticket is created with an `Idempotency-Key`. Transient failures are retried 3 times; after that the report is saved in `localStorage` and resent on the next page load or when the browser comes back online.
5. **Follow up:** tickets refresh on page load, when the panel opens, every 30 seconds while it's open, and every 5 minutes while it's closed. A badge shows unread updates.

## The contract with Planora

All endpoints are under `/widget/v1`, defined in [packages/contract/src/index.ts](packages/contract/src/index.ts):

| Endpoint | Purpose |
|---|---|
| `GET /config` | Branding, mode (`team` / `public`), features, limits. Needs only the site key. |
| `POST /session` | Exchanges the user plus hash (or an anonymous id) for a short-lived token |
| `POST /uploads` | Presigned upload URLs for the screenshot and attachments |
| `POST /tickets` | Creates a ticket (`Idempotency-Key` header). Response status is `to_do`. |
| `GET /tickets` | The current user's tickets |
| `GET /tickets/:id` | Detail: status, `status_label`, blockers, summary, PR URL, timeline |
| `POST /tickets/:id/replies` | Reply to a blocker or add a comment |

The widget shows only the statuses `to_do`, `in_progress`, `blocked`, `in_review`, `shipped` and `declined`. The Planora API maps its internal job states onto these and sends its own `status_label`, so wording such as "Shipped" versus "Merged" is decided on the server, not in the widget.

**To connect the real Planora API:** implement these endpoints there with `@planora/widget-contract` for validation, then point `data-api-base` (or `apiBase`) at it. The mock API in `packages/mock-api/src/server.ts` is a working reference implementation.

## Scripts

| Script | |
|---|---|
| `npm run dev` | Build, then watch core and loader, run the mock API and the playground |
| `npm run build` | Build all packages |
| `npm run typecheck` | Typecheck every package |
| `npm test` | Unit tests (Vitest) |
| `npm run test:php` | Laravel renderer tests |
| `npm run e2e` | Playwright tests in the real browser. Uses installed Edge locally; set `PW_CHANNEL=chrome` for Chrome. |
| `npm run size` | Bundle budgets: loader ≤ 3 KB, core ≤ 40 KB, screenshot ≤ 15 KB (gzipped) |
| `npm run check` | Everything above except e2e |
