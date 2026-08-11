# AnyPub

AnyPub is a local-first CMS for writing and scheduling articles across a user's `standard.site` publications.

## Architecture

- `apps/web`: Next.js App Router UI using shadcn-style source components.
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

AT Protocol accounts are linked through discovery, PAR, PKCE, DPoP-bound token exchange, encrypted token/key persistence, DPoP nonce retry, and refresh-token rotation. Existing accounts created before these fields and scopes were added must reconnect. Production startup requires `TOKEN_ENCRYPTION_KEY` to be valid base64 containing at least 32 bytes.

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

## Railway testing environment

The shared development stack runs in Railway's `development` environment:

- Web: `https://testing.anypub.at`
- API and OAuth metadata: `https://api.testing.anypub.at`
- API state: a persistent Railway volume mounted at `/data`

The web service uses the root [`railway.json`](./railway.json) and
[`Dockerfile.web`](./Dockerfile.web). The API service uses
[`services/backend/railway.json`](./services/backend/railway.json) and
[`services/backend/Dockerfile`](./services/backend/Dockerfile); deploy the API
from `services/backend` so those paths are its build context.

Required Railway variables are documented in [`.env.example`](./.env.example).
Set `APP_ENV=dev` on the development Web service to show the environment banner;
production defaults to no banner when the variable is omitted.
`TOKEN_ENCRYPTION_KEY` must be stored as a Railway secret and must not be
committed. Marque is authoritative for `anypub.at`; both testing hostnames use
Railway-provided CNAME and `_railway-verify` TXT records managed there.

The Railway `production` environment is intentionally unconfigured. Promote or
configure it only after the testing environment has been reviewed.
