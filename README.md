# AnyPub

AnyPub is a local-first CMS for writing and scheduling articles across a user's `standard.site` publications.

## Architecture

- `apps/web`: Next.js App Router UI using shadcn-style source components.
- `packages/block-editor`: publishable `@stygian/markdown-editor` React package; AnyPub-specific image storage stays in `apps/web`.
- `services/backend`: Swift/Vapor API with Fluent SQLite persistence.
- Drafts, cover assets, OAuth state, publish attempts, and calendar links are stored off-protocol in SQLite and the local filesystem.

## Publishing Shape

Published articles use a canonical `site.standard.document` record with shared metadata, plaintext fallback, optional `coverImage`, and a host-native structured `content` union:

- Leaflet: `pub.leaflet.content` with linear-document pages and Leaflet block records.
- Offprint: `app.offprint.content` plus an `app.offprint.document.article` strong-reference wrapper.
- pckt: `blog.pckt.content` plus a `blog.pckt.document` wrapper linked to the existing `blog.pckt.publication`.

The backend validates the editor's schema-v1 block snapshot, preserves headings, quotes, nested lists, task state, code languages, thematic breaks, and UTF-8-indexed rich-text facets. Legacy Markdown-only drafts use the same canonical parser. Large Leaflet and pckt bodies automatically switch to their lexicon-defined blob modes; Offprint bodies are size-checked before publication.

Publishing a known host without a valid adapter is rejected before any remote write. New Offprint and pckt wrapper failures trigger compensating deletion of the canonical document, and wrapper-backed posts remove both records when reverted or deleted.

Scheduling creates or updates `community.lexicon.calendar.event` records linked to the article URL and document AT-URI when available.

## Backfilling published posts

Published documents are public repository records, so `POST /api/drafts/backfill` imports every
`site.standard.document` in the account's PDS that no local draft tracks yet. The workspace runs it
once per account per session and again on a manual publication sync, so posts written outside
AnyPub appear under Published with their document AT-URI, CID, and — for Offprint and pckt — their
host wrapper record, which keeps unpublish and delete complete.

Bodies are read back into Markdown from whichever content union the host wrote (`pub.leaflet.content`,
`app.offprint.content`, `blog.pckt.content`, or `at.markpub.markdown`), including offloaded blob
bodies, rich-text facets, nested and task lists, code languages, and thematic breaks; a document
whose content cannot be read falls back to its `textContent`. Cover and body images are downloaded
into local assets that keep the original blob reference, so republishing reuses the published blob
instead of uploading a copy. Images that cannot be downloaded degrade to links, and documents whose
`site` is not a cached publication are skipped.

AT Protocol accounts are linked through discovery, PAR, PKCE, DPoP-bound token exchange, encrypted token/key persistence, DPoP nonce retry, and refresh-token rotation. Existing accounts created before these fields and scopes were added must reconnect. Production startup requires `TOKEN_ENCRYPTION_KEY` to be valid base64 containing at least 32 bytes.

## Research

The Research tab shows the linked account’s Semble collections and Margin notes. Choose **Use in post**
on an item to select its quote, source link, or comment and preview the content. Add it to the end of
an existing draft, or start a new draft in a chosen publication; either action opens the post editor.
Existing draft writing and metadata are preserved. Published, scheduled, and publishing posts are
excluded from insertion. Research source records are unchanged, and publication remains a separate action.

## Development

```bash
bun install
bun run dev
```

Backend-only:

```bash
cd services/backend
swift run App
```

Full verification:

```bash
bun run verify
```

## Continuous integration and deployment

GitHub Actions runs path-aware checks for pull requests and pushes to `main` or `dev`:

- Changes to `apps/web`, `packages/block-editor`, or the root Bun/Turbo build files run the
  frontend typecheck, lint, complete Vitest suites, and production build.
- Changes to `services/backend` run the complete Swift test suite and a release build.
- Shared CI or workflow changes run both pipelines. Documentation-only changes skip both while
  still passing the stable `Required CI gate` check.
- Railway development tracks `dev` directly and deploys only the affected service after GitHub CI passes.

Configure GitHub and each Railway service before enabling deployments:

1. Protect `main` and require the `Required CI gate` status check.
2. Connect both Railway services to this GitHub repository and track the environment's deployment
   branch (`dev` for development).
3. Enable Railway's **Wait for CI** setting on both services.
4. Keep the service watch paths in the committed `railway.json` files; patterns are relative to
   the repository root.

No Railway token or deployment secret is required in GitHub Actions. Railway owns deployment and
uses the committed Dockerfile configuration for each service.

## Railway testing environment

The shared development stack runs in Railway's `development` environment:

- Web: `https://testing.anypub.at`
- API and OAuth metadata: `https://api.testing.anypub.at`
- API state: a persistent Railway volume mounted at `/data`

The web service uses the root [`railway.json`](./railway.json) and
[`Dockerfile.web`](./Dockerfile.web). The API service uses
[`services/backend/railway.json`](./services/backend/railway.json) and
[`services/backend/Dockerfile`](./services/backend/Dockerfile). Its Railway
root directory is `/services/backend`; run manual deployments from the
repository root so the config's repository-absolute Dockerfile path resolves
the same way as GitHub deployments.

Required Railway variables are documented in [`.env.example`](./.env.example).
Set `APP_ENV=dev` on the development Web service to show the environment banner;
production defaults to no banner when the variable is omitted.
`TOKEN_ENCRYPTION_KEY` must be stored as a Railway secret and must not be
committed. Marque is authoritative for `anypub.at`; both testing hostnames use
Railway-provided CNAME and `_railway-verify` TXT records managed there.

The Railway `production` environment is intentionally unconfigured. Promote or
configure it only after the testing environment has been reviewed.
