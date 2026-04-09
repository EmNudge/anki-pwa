#!/usr/bin/env bash
# Build the anki-sync-server binary from the adjacent anki repository.
# Usage: ./scripts/build-sync-server.sh [--release]
#
# The binary is placed where integration tests expect it:
#   ../anki/target/{debug,release}/anki-sync-server
#
# In CI, set ANKI_REPO to override the repo path, or ANKI_SYNC_SERVER_BIN to
# skip building entirely (point to a pre-built binary).

set -euo pipefail

if [[ -n "${ANKI_SYNC_SERVER_BIN:-}" ]] && [[ -x "${ANKI_SYNC_SERVER_BIN}" ]]; then
  echo "Using pre-built binary: ${ANKI_SYNC_SERVER_BIN}"
  exit 0
fi

ANKI_REPO="${ANKI_REPO:-$(cd "$(dirname "$0")/../.." && pwd)/anki}"

if [[ ! -d "${ANKI_REPO}/rslib/sync" ]]; then
  echo "Error: Anki repository not found at ${ANKI_REPO}"
  echo "Clone it with: git clone https://github.com/ankitects/anki.git ${ANKI_REPO}"
  exit 1
fi

PROFILE="debug"
CARGO_FLAGS=()
if [[ "${1:-}" == "--release" ]]; then
  PROFILE="release"
  CARGO_FLAGS+=("--release")
fi

echo "Building anki-sync-server (${PROFILE}) from ${ANKI_REPO}..."
cd "${ANKI_REPO}"
cargo build --package anki-sync-server "${CARGO_FLAGS[@]}"

BINARY="${ANKI_REPO}/target/${PROFILE}/anki-sync-server"
if [[ ! -x "${BINARY}" ]]; then
  echo "Error: Binary not found at ${BINARY}"
  exit 1
fi

echo "Built: ${BINARY}"
