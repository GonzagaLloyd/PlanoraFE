# planora/laravel-widget

Adds the Planora bug & feature reporting widget to a Laravel app.

## Install

```bash
composer require planora/laravel-widget
```

Add your keys to `.env`:

```dotenv
PLANORA_SITE_KEY=pk_live_xxx
PLANORA_SECRET=sk_live_xxx
```

Put the directive in your main layout, just before `</body>`:

```blade
@planoraWidget
```

That's all. For a logged-in user the directive also calls `identify` with their id, name and email, plus a `userHash` signed with `PLANORA_SECRET` on the server. The secret is never sent to the browser.

## Options

Publish the config to change anything:

```bash
php artisan vendor:publish --tag=planora-config
```

| Key | Env | Default |
|---|---|---|
| `enabled` | `PLANORA_ENABLED` | `true` |
| `site_key` | `PLANORA_SITE_KEY` | — |
| `secret` | `PLANORA_SECRET` | — |
| `api_base` | `PLANORA_API_BASE` | `https://api.planora.dev` |
| `cdn_url` | `PLANORA_CDN_URL` | `https://cdn.planora.dev/widget/v1` |
| `position` / `color` / `label` | `PLANORA_POSITION` / `PLANORA_COLOR` / `PLANORA_LABEL` | dashboard branding |
| `guard` | `PLANORA_GUARD` | default guard |
| `user_fields` | — | `['name' => 'name', 'email' => 'email']` |

If you use Vite's CSP nonce (`Vite::useCspNonce()`), the nonce is added to both script tags automatically.

## Tests

```bash
php tests/render_test.php
```
