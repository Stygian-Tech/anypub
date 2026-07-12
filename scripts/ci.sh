#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export CI="${CI:-true}"
if [[ ! -d "${DEVELOPER_DIR:-}" && -d "/Applications/Xcode-beta.app/Contents/Developer" ]]; then
  export DEVELOPER_DIR="/Applications/Xcode-beta.app/Contents/Developer"
fi

echo "==> Bun workspace install"
bun install --frozen-lockfile

echo "==> Frontend typecheck"
bun run typecheck

echo "==> Frontend lint"
bun run lint

echo "==> Frontend tests"
bun run test

echo "==> Frontend build"
bun run build

echo "==> Swift tests"
(
  cd services/backend
  swift test --skip-update --enable-swift-testing --disable-xctest --no-parallel
)

echo "==> Swift release build"
(
  cd services/backend
  swift build -c release --product App --skip-update
)
