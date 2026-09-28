# Releasing the Planora widget

This guide covers publishing `@planora/widget`, `@planora/widget-react` and `@planora/widget-contract` to npm: the one-time setup, the first release, and the routine for every release after that.

## Already set up in this repo

- **Package metadata:** the three public packages have their repository links, keywords, a README each, `publishConfig.access = public` and npm provenance.
- **Versioning:** [changesets](https://github.com/changesets/changesets). The three packages share one version number, so `@planora/widget` 1.2.0 always pairs with `@planora/widget-react` 1.2.0.
- **Release workflow:** [`.github/workflows/release.yml`](../.github/workflows/release.yml). It runs every check, then publishes. It stays **switched off** until you set `RELEASE_ENABLED`.
- **Dry run:** `npm run release:dry-run` builds and lists exactly what each package would upload, without publishing anything.
- **Install test:** the packed packages were installed into a fresh project, typechecked strictly, and imported at runtime. Installing `@planora/widget` downloads only `zod` besides our own packages, because Preact and the screenshot library are bundled.

Private packages are never published: the loader, the mock API and the playground.

---

## One-time setup (≈15 minutes, done by the account owner)

### 1. Create the `@planora` organization on npm
Nobody owns the `@planora` scope yet (checked on 2026-09-28). The first person to create the org gets it, so do this soon.

1. Sign in at https://www.npmjs.com. Create an account first if you need one, and **turn on two-factor authentication**.
2. Open your avatar menu → **Add Organization**.
3. Name: **`planora`**. This name *is* the scope: packages become `@planora/…`.
4. Choose the **free plan** (unlimited public packages).
5. Optionally, under the org's **Members** tab, invite teammates who should be able to publish.

> If `planora` is taken by the time you try, pick another name, such as `planora-dev`. Then rename the packages, e.g. `@planora-dev/widget`: change `name` in the three `packages/*/package.json` files, the `fixed` list in `.changeset/config.json`, and the imports in `packages/react/src/index.ts` and the docs.

### 2. Create a publish token
1. On npmjs.com: avatar → **Access Tokens** → **Generate New Token** → **Granular Access Token**.
2. Name it `PlanoraFE GitHub Actions`.
3. **Packages and scopes:** *Read and write*, limited to the **`@planora`** scope.
4. **Organizations:** no access needed.
5. **Expiration:** the longest npm allows. Put a reminder in your calendar to renew it.
6. If npm offers it, allow the token to publish without a one-time password, since GitHub Actions can't type one.
7. Copy the token now. npm shows it only once.

### 3. Give the token to GitHub, and switch the workflow on
In https://github.com/GonzagaLloyd/PlanoraFE → **Settings** → **Secrets and variables** → **Actions**:
1. **Secrets** tab → **New repository secret** → name `NPM_TOKEN`, value: the token.
2. **Variables** tab → **New repository variable** → name `RELEASE_ENABLED`, value `true`.

Then **Settings** → **Actions** → **General** → *Workflow permissions*:
- select **Read and write permissions**;
- tick **Allow GitHub Actions to create and approve pull requests**. The workflow opens the "Version packages" PR.

### 4. LICENSE ✅ done
MIT, `Copyright (c) 2026 swiftlyph_planora`. The root `LICENSE` is copied into `packages/contract`, `packages/core`, `packages/react` and `integrations/laravel`, because npm and Packagist only ship a license file that sits inside the package folder. If the license ever changes, update all five copies.

---

## First release (0.1.0)

No changeset is needed. `changeset publish` uploads any version that isn't on npm yet, and 0.1.0 isn't.

1. Push `main` (or re-run the latest **Release** workflow from the **Actions** tab).
2. The workflow builds, typechecks, tests, checks bundle sizes, then publishes all three packages.
3. Check:
   - https://www.npmjs.com/package/@planora/widget shows version 0.1.0, the README, and a *Provenance* badge.
   - In any project: `npm install @planora/widget-react` works.
4. The workflow also pushes git tags such as `@planora/widget@0.1.0`.

<details>
<summary>Publishing the first version from your own machine instead</summary>

```bash
npm login                       # opens the browser; complete 2FA
npm run build
npm publish -w @planora/widget-contract -w @planora/widget -w @planora/widget-react --provenance=false
```
`--provenance=false` is required locally: provenance can only be generated inside CI. Later releases can go through the workflow as usual.
</details>

---

## Every release after that

1. **Describe the change** on your branch:
   ```bash
   npx changeset
   ```
   - Select the packages you changed. All three are released together anyway.
   - Choose the bump:

     | Bump | When |
     |---|---|
     | `patch` | bug fixes |
     | `minor` | new features that break nothing |
     | `major` | breaking changes: a renamed option, a changed API field |

   - Write one line for the changelog, e.g. *"Blocked tickets now show a reply box."*

   While the version is 0.x, breaking changes may go out as `minor`.
2. **Commit** the new file in `.changeset/` with your code, and merge to `main` as usual.
3. The workflow **opens or updates a "Version packages" PR**. It bumps the versions, updates the internal dependency ranges and writes a `CHANGELOG.md` for each package. Several merged changes collect into the same PR.
4. **Merge that PR** when you want to release. The workflow runs again and publishes the new versions.

Nothing is published until step 4, so you can merge features freely and release when you're ready.

---

## Optional: replace the token with Trusted Publishing
After the first release exists on npm, you can drop the long-lived token:
1. On npmjs.com, open each package → **Settings** → **Trusted Publisher** → **GitHub Actions**.
2. Repository `GonzagaLloyd/PlanoraFE`, workflow file `release.yml`.
3. Once all three are set up, delete the `NPM_TOKEN` secret.

---

## Still to set up (separate decisions)

### Script-tag install (CDN)
Sites that don't use npm load `loader.js` from a URL. That needs:
1. **A host:** Cloudflare Pages/R2, S3 + CloudFront, or served from the Planora app's own domain.
2. **A path:** `/widget/v1/`, holding `loader.js`, `widget.js` and `chunks/`.
3. **Caching:**
   - `chunks/*` carry a content hash, so they can be cached for a year;
   - `loader.js` and `widget.js` should be cached for about 5 minutes, so fixes reach sites quickly.
4. **A deploy step** in `release.yml` that uploads `packages/loader/dist` and `packages/core/dist` after publishing.
5. **Updated URLs:** replace the placeholder `cdn.planora.dev` in the docs and in the Laravel config default.

### Laravel package (Packagist)
Packagist needs `composer.json` at the root of a repository, so `integrations/laravel` needs its own repo:
1. Create an empty GitHub repo, e.g. `GonzagaLloyd/planora-laravel-widget`.
2. Add a workflow here that copies `integrations/laravel` into it on every release, using `git subtree split` or a split action, and tags the same version.
3. Submit that repo at https://packagist.org/packages/submit, and enable the GitHub hook so new tags appear automatically.
4. Clients then run `composer require planora/laravel-widget`.

### Point the widget at the real Planora
When the Planora API implements `/api/v1/widget`:
1. Run the contract tests against it (see [WIDGET_API.md](WIDGET_API.md)).
2. Change `DEFAULT_API_BASE` in `packages/core/src/planora.ts` to the production URL.
3. Release a new version.

---

## Troubleshooting

| Error | Cause and fix |
|---|---|
| `E404 Not Found – PUT …/@planora%2fwidget` | The `@planora` org doesn't exist, or the token's account isn't a member. Do step 1. |
| `E403 Forbidden` | The token lacks write access to `@planora`, or has expired. Create a new one (step 2) and update the secret. |
| `EOTP` / "one-time password required" | The token can't bypass 2FA. Create a granular token that's allowed to publish without an OTP, or switch to Trusted Publishing. |
| `provenance … only supported in CI` | You published from your laptop. Add `--provenance=false` (first-release box above). |
| The workflow doesn't run | `RELEASE_ENABLED` isn't set to `true` (step 3). |
| The "Version packages" PR isn't opened | Actions isn't allowed to create PRs (step 3, workflow permissions). |
| `You cannot publish over the previously published versions` | That version already exists on npm. Add a changeset and release a new version. |
