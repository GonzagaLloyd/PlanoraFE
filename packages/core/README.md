# @planora/widget

A floating "report a bug / request a feature" bubble for any website. Reports go to your Planora board as tickets, and the reporter can follow each one in the bubble: In Progress, Blocked (with a reply box), In Review, Shipped.

```bash
npm install @planora/widget
```

```ts
import { Planora } from '@planora/widget';

Planora.init({
  siteKey: 'pk_live_…',
  // The logged-in user. userHash = HMAC-SHA256(user.id, site secret), computed on your server.
  user: { id: '42', name: 'Ana Reyes', email: 'ana@client.com', userHash },
});
```

Using React or Next.js? Install [`@planora/widget-react`](https://www.npmjs.com/package/@planora/widget-react) instead. Any other site can use the script tag:

```html
<script src="https://cdn.planora.dev/widget/v1/loader.js" data-site-key="pk_live_…" async></script>
```

## API

| Call | Does |
|---|---|
| `init(options)` | Start the widget |
| `identify(user \| null)` | Set or clear the logged-in user |
| `open('home' \| 'report' \| 'list')`, `close()`, `toggle()` | Control the panel from your own UI |
| `setMetadata({ appVersion, tenant })` | Extra context attached to every report |
| `on(event, fn)` | `ticket:created`, `status:changed`, `ticket:queued`, `open`, `close`, `ready` |
| `shutdown()` | Remove the widget and restore everything it patched |

## What it records, and what it never sends

When the reporter opens the bubble it captures the page URL, a screenshot of the visible screen, recent console errors, failed or slow requests, and route changes. The reporter can turn the screenshot and the technical details off before sending.

Before anything leaves the browser:
- form values, tokens, auth headers, cookies, emails and card-like numbers are removed;
- password fields and any element with `data-planora-mask` are blurred in screenshots and blanked in the page snapshot.

The widget runs in a Shadow DOM: your CSS can't break it, and its CSS can't leak onto your site.

Full documentation: https://github.com/GonzagaLloyd/PlanoraFE
