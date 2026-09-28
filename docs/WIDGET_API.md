# Widget API: the spec for Planora (`/api/v1/widget`)

The embeddable Planora widget calls these endpoints from client websites. This spec is written for the Laravel implementation in `planora/apps/api`, and it follows that codebase's conventions:

- Routes are under `api/v1` and named one per line. Nothing custom is needed for CORS paths or the Scramble export.
- Success bodies use the `JsonResource` wrapper: `{ "data": … }`.
- Errors use Laravel's default shape: `{ "message": "…" }`, plus `"errors": { "field": ["…"] }` on **422**.
- IDs are integers, timestamps are ISO-8601 strings, and field names are snake_case.

Two sources stay in sync with this document:

- **Types:** [`packages/contract/src/index.ts`](../packages/contract/src/index.ts). The zod schemas there match the request and response shapes below exactly.
- **Executable spec:** [`e2e/api-contract.spec.ts`](../e2e/api-contract.spec.ts). To run it against a Planora instance:
  ```bash
  WIDGET_API_BASE=http://localhost:8000 WIDGET_SITE_KEY=pk_… WIDGET_SITE_SECRET=sk_… npx playwright test api-contract
  ```
  The site must be in team mode with user-hash verification on. When all of these tests pass, the widget works against Planora.

A working reference implementation lives in [`packages/mock-api/src/server.ts`](../packages/mock-api/src/server.ts).

---

## Authentication

| Header | Sent on | Meaning |
|---|---|---|
| `X-Planora-Site-Key: pk_…` | every request | Identifies the widget site: its organization, project, intake column and settings. Public, visible in page source. |
| `Authorization: Bearer <token>` | everything except `config` and `session` | Short-lived widget session token from `POST session`. |
| `Idempotency-Key: <uuid>` | `POST tickets` | The same key on the same site returns the original ticket instead of creating a second one. |

**How the API should resolve a request:**
1. Look up the site by key. If it's unknown or disabled, return **401**.
2. Check `Origin` against the site's allowed origins. If it isn't allowed, return **403**.
3. Validate the session token for this site. If it's missing, expired or belongs to another site, return **401**. The widget starts a new session once and retries.
4. Bind the organization with `OrganizationContext` for the rest of the request. This must happen before route-model binding, the way `SetOrganizationContext` does it. There is no `User`, so check authorization in the controller, as `CompleteAiRoutineRunController` does.

**CORS:** each site has its own allowed origins, so the widget routes need their own CORS handling, including preflight `OPTIONS` requests. The global `config/cors.php` list only covers Planora's own web app.
- Allowed request headers: `Content-Type`, `Accept`, `Authorization`, `X-Planora-Site-Key`, `Idempotency-Key`.
- Credentials are not used.

**Rate limits:** use named limiters, per site key plus IP, especially on `session` and `tickets`. A spike returns **429**, and the widget backs off and retries.

---

## Endpoints

### `GET /api/v1/widget/config`
Site key only, no session. The widget uses this to decide whether to show the bubble and how it looks.

**200**
```json
{ "data": {
  "enabled": true,
  "site_name": "Demo Shop",
  "mode": "team",
  "branding": { "launcher_label": "Report an issue", "position": "bottom-right" },
  "features": { "screenshot": true, "attachments": true, "replies": true },
  "limits": { "max_attachments": 5, "max_attachment_bytes": 10485760 }
} }
```
- `mode: "team"`: only identified users (the client's own staff) can report. This is the default.
- `mode: "public"`: anonymous visitors can report too.
- If `enabled` is false, the widget hides itself.

### `POST /api/v1/widget/session`
Exchanges an identity for a session token. Site key only.

**Request**
```json
{ "user": { "id": "42", "name": "Ana Reyes", "email": "ana@client.com" }, "user_hash": "<hex>" }
```
or, in public mode, `{ "anonymous_id": "<uuid from the browser>" }`.

- `user_hash` = `HMAC-SHA256(user.id, site secret)`, hex. It is computed **on the client's server**, and the secret never reaches the browser.
- Compare hashes with `hash_equals`.

**200**
```json
{ "data": { "token": "…", "expires_at": "2026-09-28T10:00:00Z", "user": { "id": "42", "name": "Ana Reyes" } } }
```

**Errors:**
- **401** if the site is in team mode and no user was sent, or if the hash doesn't match. The message should mention the hash.
- **422** if neither `user` nor `anonymous_id` was sent.

### `POST /api/v1/widget/uploads`
Asks for signed URLs for the screenshot and attachments, before the ticket is created.

**Request**
```json
{ "files": [ { "name": "screenshot.jpg", "content_type": "image/jpeg", "size": 53406, "kind": "screenshot" } ] }
```
- 1 to 10 files.
- `kind` is `screenshot` or `attachment`.

**200:** one entry per file, in the same order.
```json
{ "data": [ {
  "id": "9b2f…",
  "upload_url": "https://api…/api/v1/widget/uploads/9b2f…?expires=…&signature=…",
  "method": "PUT",
  "headers": { "Content-Type": "image/jpeg" },
  "expires_at": "2026-09-28T09:10:00Z"
} ] }
```
- **422** if a file is larger than `limits.max_attachment_bytes`.

**`PUT {upload_url}`**
- The raw file bytes are the body. No `Authorization` header: the signature is the only authorization.
- Use `URL::temporarySignedRoute` plus the `signed` middleware today, or an S3 presigned URL later. The widget doesn't care which.
- Returns 204 or 200. An invalid or expired signature returns **403**.
- Store files on the `public` disk. In Planora they end up as attachments on the ticket's first task comment (see below).

### `POST /api/v1/widget/tickets`
Creates the ticket. Send the `Idempotency-Key` header.

**Request**
```json
{
  "type": "bug",
  "title": "Checkout button does nothing",
  "description": "I click Place order and nothing happens.",
  "attachment_ids": [],
  "screenshot_id": "9b2f…",
  "context": { "page_url": "…", "console": [], "errors": [], "network": [], "navigation": [], "dom_snapshot": "…", "metadata": {}, "…": "see CaptureContext" }
}
```
- `type` is `bug` or `feature`.
- `title` is 3–200 characters. `description` is 1–10 000 characters.
- `context` may be `null` if the reporter turned off technical details. The browser has already removed secrets from it.

**201**
```json
{ "data": { "id": 17, "key": "SHOP-12", "type": "bug", "title": "Checkout button does nothing",
            "status": "to_do", "status_label": "To Do", "created_at": "…", "updated_at": "…" } }
```
- **200** with the original ticket when the same `Idempotency-Key` is replayed.
- **422** for validation errors, or when an upload id is unknown or its file was never uploaded.

**What Planora does with it** (tickets 2–3):
- Create a **task** in the site's project, in its intake column, using `OrganizationContext::runFor`.
- Create a widget ticket record linking the task, the site, the reporter (external id, name, email) and `context`.
- `key` is the site's ticket prefix plus a per-site number.
- Post a first task comment carrying the screenshot, attachments and a readable summary of `context`. The team sees everything on the existing board with no web-app changes.

### `GET /api/v1/widget/tickets`
The session user's own tickets on this site, newest update first. Optional `?updated_since=<ISO>`.

**200**
```json
{ "data": [ { "id": 17, "key": "SHOP-12", "type": "bug", "title": "…", "status": "blocked", "status_label": "Blocked", "created_at": "…", "updated_at": "…" } ] }
```

### `GET /api/v1/widget/tickets/{id}`
**200**
```json
{ "data": {
  "id": 17, "key": "SHOP-12", "type": "bug", "title": "…", "status": "blocked", "status_label": "Blocked",
  "created_at": "…", "updated_at": "…",
  "description": "…",
  "blockers": [ { "id": 3, "message": "Which columns should the CSV include?", "needs_reply": true } ],
  "summary": null,
  "pull_request_url": null,
  "timeline": [ { "id": 51, "at": "…", "kind": "created", "author": "reporter", "status": "to_do", "message": "Ticket created" } ]
} }
```
- **404** for someone else's ticket, never 403, so ids can't be probed.
- `blockers` is empty unless the status is `blocked`.
- `summary` is plain language that's safe to show the reporter, never internal reasoning.
- `timeline[].author` is `reporter` or `planora`.
- `timeline[].kind` is `created`, `status_changed`, `reply` or `note`.

### `POST /api/v1/widget/tickets/{id}/replies`
**Request:** `{ "message": "Order number, date, customer, total.", "blocker_id": 3 }`. `blocker_id` is optional.

**201:** the updated ticket detail, in the same shape as `GET tickets/{id}`.
- **403** if replies are turned off for the site. **404** if it isn't the caller's ticket.

In Planora, a reply becomes a task comment authored by the reporter (`author_name` = the reporter's name, `author_id` = null). If the ticket was blocked, it goes back into the AI routine queue.

---

## Statuses the widget shows

The API computes one of these per ticket. The widget never sees Planora's internal states.

| `status` | Suggested rule in Planora |
|---|---|
| `to_do` | Task is in the intake column, or any non-terminal column with no AI run started |
| `in_progress` | Latest AI routine run is `running`, or the task sits in a working column |
| `blocked` | Latest run reported `blocked`; `blockers[]` comes from it |
| `in_review` | Latest run reported a `pull_request_url` and the task isn't done yet |
| `shipped` | Task is in a terminal column (`statuses.is_terminal`) |
| `declined` | The team declined the ticket; `summary` holds the reason |

`status_label` is display text chosen by the API. For example, if "Shipped" should read "Merged", change the label, not the status.
