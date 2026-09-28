# Releasing the Planora widget

This guide covers publishing `@planora/widget`, `@planora/widget-react` and `@planora/widget-contract` to npm: how the release pipeline works, the routine for every release, and how it was set up.

## Current state

| | |
|---|---|
| npm organization | [`@planora`](https://www.npmjs.com/org/planora), owner `lloydgonzaga`, 2FA on |
| Published | `0.1.0` of all three packages, published by hand on 2026-09-28 |
| Automatic releases | [`.github/workflows/release.yml`](../.github/workflows/release.yml) with **npm Trusted Publishing**: no npm token, no 2FA code |
| Switch | the repository variable `RELEASE_ENABLED` = `true` |
| Versioning | [changesets](https://github.com/changesets/changesets). The three packages share one version number, so `@planora/widget` 1.2.0 always pairs with `@planora/widget-react` 1.2.0. |

Private packages are never published: the loader, the mock API and the playground.

`npm run release:dry-run` builds and lists exactly what each package would upload, without publishing anything.

---

## Every release

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
4. **Merge that PR** when you want to release. The workflow runs every check again, then publishes the new versions with provenance, and pushes git tags such as `@planora/widget@0.2.0`.

Nothing is published until step 4, so you can merge features freely and release when you're ready.

---

## How it was set up (for reference, or to redo it)

### 1. npm organization ✅
On npmjs.com: turn on **two-factor authentication**, then avatar → **Add Organization** → name `planora` → free plan (unlimited public packages).

### 2. First publish by hand ✅
Your account requires 2FA for publishing, and a GitHub token can't type a 2FA code. npm is also removing tokens that bypass 2FA (January 2027). So the first version was published from a laptop:

```bash
npm login                      # browser sign-in with the security key
npm run build
npm publish -w @planora/widget-contract --provenance=false   # each asks for the security key
npm publish -w @planora/widget --provenance=false
npm publish -w @planora/widget-react --provenance=false
```
- Keep this order: each package depends on the previous one.
- `--provenance=false` is required locally, because provenance can only be generated inside CI.

### 3. Trusted Publishing, per package
Trusted Publishing can only be configured on a package that already exists, which is why step 2 came first.

For each of the three packages: npmjs.com → the package → **Settings** → **Trusted Publisher** → **GitHub Actions**:
- **Organization or user:** `GonzagaLloyd`
- **Repository:** `PlanoraFE`
- **Workflow filename:** `release.yml`
- **Environment:** empty

Optionally, under **Settings** → **Publishing access**, choose *"Require two-factor authentication and disallow tokens"*. After that, only this workflow or a person with the security key can publish.

### 4. GitHub settings ✅
In https://github.com/GonzagaLloyd/PlanoraFE → **Settings**:
- **Secrets and variables → Actions → Variables:** `RELEASE_ENABLED` = `true`.
- **Actions → General → Workflow permissions:** *Read and write permissions*, and *Allow GitHub Actions to create and approve pull requests*.
- **No npm secret is needed.** Once Trusted Publishing works, delete the old `NPM_TOKEN` secret and revoke that token on npmjs.com (avatar → Access Tokens).

### 5. LICENSE ✅
MIT, `Copyright (c) 2026 swiftlyph_planora`. The root `LICENSE` is copied into `packages/contract`, `packages/core`, `packages/react` and `integrations/laravel`, because npm and Packagist only ship a license file that sits inside the package folder. If the license ever changes, update all five copies.

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
| `E404 Not Found – PUT …/@planora%2fwidget` in the workflow | That package has no Trusted Publisher set up yet, or it names a different repository or workflow file. Recheck step 3 for that package. |
| `ENEEDAUTH` / `E401` in the workflow | npm is older than 11.5.1, or the job lacks `id-token: write`. Both are set in `release.yml`, so check they weren't removed. |
| `EOTP` / "one-time password required" | A token was used instead of Trusted Publishing. Remove any `NODE_AUTH_TOKEN` / `NPM_TOKEN` from the workflow and set up step 3. |
| `provenance … only supported in CI` | You published from your laptop. Add `--provenance=false` (step 2). |
| The workflow doesn't run | `RELEASE_ENABLED` isn't set to `true` (step 4). |
| The "Version packages" PR isn't opened | Actions isn't allowed to create PRs (step 4, workflow permissions). |
| `You cannot publish over the previously published versions` | That version already exists on npm. Add a changeset and release a new version. |
