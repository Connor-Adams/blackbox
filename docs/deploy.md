# Deploy

Blackbox ships as a **prebuilt Docker image** with a **release-gated** production
deploy, mirroring cashflow's model (adapted from cashflow's 7-service yarn
monorepo down to this single pnpm Next.js app).

The short version:

- Merging a PR to `main` **builds and pushes an image** to GHCR. It does **not**
  deploy.
- A draft GitHub Release is kept continuously up to date by Release Drafter,
  auto-versioned from PR-title prefixes.
- A human **publishes** that release. Publishing re-tags the already-built image
  to `:production` (plus a `:vX.Y.Z` rollback tag) and tells Railway to redeploy.
- Railway pulls `:production`. The container's start command runs DB migrations,
  then starts the server.

> Source of truth: this file. The "Deploy (Railway)" section in the top-level
> `README.md` describes the older NIXPACKS/`railway.json` flow and is superseded
> by this document.

---

## Pipeline at a glance

```
 PR merged to main
        │
        ▼
 build-images.yml ───────────────►  GHCR: ghcr.io/connor-adams/blackbox
   (push: main)                       :main
                                      :sha-<full-commit-sha>
        │
        │   (Release Drafter keeps a draft GitHub Release
        │    version-bumped from merged PR labels)
        ▼
 human publishes the GitHub Release  (vX.Y.Z)
        │
        ▼
 promote-to-production.yml ───────►  GHCR re-tag (no rebuild):
   (release: published)                :vX.Y.Z   ← rollback anchor
                                        :production
        │
        ▼
 railway redeploy --service <id>  →  Railway pulls :production
        │
        ▼
 container CMD: `pnpm db:migrate && pnpm start`
```

---

## The image (`Dockerfile`)

Multi-stage, base `node:22-slim`, pnpm via `corepack` (pinned to `pnpm@10.29.3`,
matching the `pnpm-lock.yaml` lockfileVersion 9.0 — the repo has no
`packageManager` field, so the version is pinned explicitly in the Dockerfile and
in CI rather than inferred).

- **Builder**: `pnpm install --frozen-lockfile`, then `pnpm build`.
- **Runner**: copies the built app plus the **full `node_modules`** (dev deps
  included). This is deliberate: the start command runs `pnpm db:migrate`, which
  is `drizzle-kit migrate`, and `drizzle-kit` is a `devDependency`. Pruning to
  prod-only would break migrations. For the same reason we do **not** use Next's
  `output: standalone`.

Runner contents: `.next`, `public`, `package.json`, `pnpm-lock.yaml`,
`node_modules`, `drizzle/` (generated SQL migrations), `drizzle.config.ts`,
`tsconfig.json` (drizzle-kit loads the TS config), `next.config.ts`, and `lib/`
(`drizzle.config.ts` imports `lib/db/schema.ts` at load time).

Runtime: `EXPOSE 3000`, `ENV NODE_ENV=production`, `ARG APP_VERSION`, and

```dockerfile
CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]
```

`drizzle-kit migrate` is idempotent — it applies only the migrations in
`drizzle/` that haven't run yet, so restarting the container is safe.

---

## Workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push `main`, PRs | `pnpm install`, `tsc --noEmit`, `pnpm test`, `pnpm build` on Node 20 + 22. No image, no deploy. |
| `.github/workflows/build-images.yml` | push `main` (skips `**/*.md`, `docs/**`) | Builds the image and pushes `:main` + `:sha-<full-commit-sha>` to GHCR. |
| `.github/workflows/release-drafter.yml` | push `main`, PRs | Keeps the draft GitHub Release + next-version up to date; labels PRs by title prefix. Never publishes. |
| `.github/workflows/promote-to-production.yml` | `release: published` | Re-tags the released commit's image to `:vX.Y.Z` + `:production`, then `railway redeploy`. |
| `.github/workflows/security.yml` | push `main`, PRs | CodeQL (`javascript-typescript`) + dependency review (PRs). |

### How promote resolves the released image

`promote-to-production.yml` checks out the released tag, computes
`RELEASE_SHA=$(git rev-parse HEAD)` (the **full 40-char** commit SHA), and resolves
the source image as `ghcr.io/connor-adams/blackbox:sha-<RELEASE_SHA>` — the same
tag `build-images.yml` pushed for that commit via `:sha-${{ github.sha }}`.

Matching on the **full SHA** (never an abbreviation) is intentional: it sidesteps
a class of bug where one side abbreviates the SHA to a fixed width and the other
lets git auto-grow it (7 → 8 chars), so the tags never match and every release
silently fails to deploy.

If the `:sha-` tag isn't present yet (a release published while `build-images`
was still running), promote waits up to ~5 minutes, then falls back to `:main`.

Re-tagging uses `docker buildx imagetools create`, a registry-side manifest copy
— no pull, no rebuild.

---

## Versioning (Release Drafter)

`.github/release-drafter.yml` maps conventional-commit PR-title prefixes to
labels, and labels to a semver bump:

| PR title prefix | Label | Version bump |
| --- | --- | --- |
| `feat:` | `feature` | minor |
| `fix:` | `fix` | patch |
| `perf:` | `performance` | patch |
| `deps:` | `dependencies` | patch |
| `<type>!:` (e.g. `feat!:`) | `breaking` | major |
| `chore:` / `refactor:` / `test:` / `build:` / `ci:` / `docs:` | (maintenance) | (no bump on its own; default patch) |

Tag/name template: `v$RESOLVED_VERSION`. Add the `skip-changelog` label to omit a
PR from the notes.

---

## One-time setup (Connor)

These steps require Railway + GitHub access and can't be done from this repo.
**Until they're done, `build-images` and CI work, but publishing a release will
fail at the redeploy step.**

1. **Railway service (image-based).** In the Railway project, create a service
   that deploys the GHCR image rather than building from source:
   - Source image: `ghcr.io/connor-adams/blackbox:production`
   - Add a **Postgres** plugin and set the service env var
     `DATABASE_URL=${{Postgres.DATABASE_URL}}` (Railway reference variable).
   - Set any other runtime env vars the app needs (see `.env.example`:
     `BLACKBOX_APP_URL`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, connector
     keys). `DATABASE_URL` comes from the Postgres plugin.
   - Healthcheck (optional): the app exposes `GET /api/health`.
   - The container listens on port 3000 (`EXPOSE 3000` / `pnpm start`).

2. **GHCR pull access.** Make the `blackbox` GHCR package reachable by Railway —
   either set the package to **public**, or create a GHCR pull token and add it
   to Railway as the image registry credential.

3. **GitHub repo secrets** (Settings → Secrets and variables → Actions):
   - `RAILWAY_TOKEN` — a Railway **project token** with deploy rights. Consumed
     by `@railway/cli` in `promote-to-production.yml`.
   - `RAILWAY_SERVICE_ID` — the UUID of the blackbox Railway service created in
     step 1. The promote workflow passes it to
     `railway redeploy --service <id>`. (Parameterized as a secret because the
     service doesn't exist yet.)

   `GITHUB_TOKEN` (used for GHCR login + re-tag) is provided automatically; no
   setup needed.

4. **Branch protection (optional but recommended).** Require the `ci` checks to
   pass before merging to `main`.

---

## Day-to-day flow

1. Open a PR with a conventional-commit title (`feat: …`, `fix: …`, etc.).
   Release Drafter labels it and updates the draft release's next version.
2. Merge to `main`. `build-images` pushes a fresh image (`:main`,
   `:sha-<commit>`). Nothing deploys yet.
3. When ready to ship, go to the repo's **Releases**, open the draft Release, and
   **Publish** it.
4. `promote-to-production` re-tags that commit's image to `:vX.Y.Z` and
   `:production`, then runs `railway redeploy`. Railway pulls `:production`; the
   container runs migrations and starts.

---

## Rollback

Every published release leaves a `:vX.Y.Z` tag on GHCR pointing at that exact
image. To roll back, re-point `:production` at an older version tag and redeploy:

```bash
# Re-tag an older release image as :production (registry-side, no rebuild).
docker buildx imagetools create \
  --tag ghcr.io/connor-adams/blackbox:production \
  ghcr.io/connor-adams/blackbox:v0.3.0

# Then redeploy the service so Railway re-pulls :production.
railway redeploy --service "$RAILWAY_SERVICE_ID" -y
```

(Run locally with `RAILWAY_TOKEN` set, or trigger a redeploy from the Railway
dashboard.) Because migrations are forward-only, rolling the image back does not
roll back the database — verify schema compatibility before rolling back across a
migration.

---

## `@railway/cli` is pinned to `4.66.0`

`promote-to-production.yml` installs `@railway/cli@4.66.0` deliberately.
`4.66.1` (published 2026-06-03) sends a GraphQL query with a `deletedAt` field on
`VolumeInstance` that Railway's API rejects, crashing `railway redeploy`
("Cannot query field deletedAt on type VolumeInstance"). Bump the pin only after
verifying redeploy works against the live API.

---

## A note on `railway.json`

The repo still contains a `railway.json` configured for the **NIXPACKS** builder
(`preDeployCommand: pnpm db:migrate`, `startCommand: pnpm start`). Under the
image model it is **unused**: Railway pulls the prebuilt GHCR image instead of
building from source, and migrations run inside the container's `CMD`, not via a
NIXPACKS pre-deploy hook. It's left in place (a source-based deploy would still
honor it), but the image pipeline ignores it.

---

## What's verified vs. unverified

Verified locally in this repo:

- `pnpm build` succeeds (Next.js 16.2.7).
- `pnpm exec tsc --noEmit` is clean.
- All workflow YAML parses, and the Dockerfile references real paths/scripts
  (`pnpm build`, `pnpm db:migrate`, `drizzle/`, `drizzle.config.ts`, `lib/`).

**Not** verified here (no Docker daemon / Railway access in the authoring
environment) — Connor verifies on the first CI run:

- The Docker image actually builds and runs (`docker build` / container start).
- The GHCR push, the promote re-tag, and `railway redeploy` against the live
  Railway service.
