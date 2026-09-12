#!/usr/bin/env bash
# Brings up everything a PineSign server needs: the Bee node it stores files
# through, then the gateway itself. Bee runs in the background and keeps its
# state in a Docker volume, so this is safe to run repeatedly.
set -euo pipefail

cd "$(dirname "$0")"

if docker info > /dev/null 2>&1; then
  echo "starting the Bee node…"
  docker compose up -d bee
else
  echo "Docker is not running — starting without a Bee node."
  echo "Files will be stored locally until you start one."
fi

exec node gateway/server.js
