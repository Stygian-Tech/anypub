# AnyPub

AnyPub is a local-first CMS for writing and scheduling articles across a user's `standard.site` publications.

## Architecture

- `apps/web`: Next.js App Router UI using shadcn-style source components.
- `services/backend`: Swift/Vapor API with Fluent SQLite persistence.
- Drafts, cover assets, OAuth state, publish attempts, and calendar links are stored off-protocol in SQLite and the local filesystem.

## V1 Publishing Shape

Published records are canonical `site.standard.document` records with minimal fields: publication reference, title, publish date, optional path, tags, description, plaintext, update date, and optional `coverImage` blob. Structured `content` blocks are intentionally deferred.

Scheduling creates or updates `community.lexicon.calendar.event` records linked to the article URL and document AT-URI when available.

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
