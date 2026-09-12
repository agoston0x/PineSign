#!/usr/bin/env bash
# Runs the gateway tests against a throwaway server with no credentials, so the
# suite exercises the unconfigured path and never touches a real wallet.
set -euo pipefail

cd "$(dirname "$0")/.."
PORT=${PORT:-8799}
rm -rf .storage

PINESIGN_SKIP_ENV_FILE=1 PORT="$PORT" node gateway/server.js > /tmp/pinesign-test.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  curl -s "http://localhost:$PORT/api/health" > /dev/null 2>&1 && break
  perl -e 'select(undef,undef,undef,0.25)'
done

BASE="http://localhost:$PORT" node test/flow.js
