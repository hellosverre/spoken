#!/usr/bin/env bash
# Keeps the Spoken call server up on Hugin: restarts it if it exits.
# Secrets come from server/.env (bas:// handles) through bas-secret.
set -u
cd "$(dirname "$0")/../server"
: "${BAS_SECRET_TOKEN:?set BAS_SECRET_TOKEN}"
while true; do
  echo "[run-server] start $(date -Is)"
  /home/sverre/Projects/bas/ops/bas-secret run -- env CALL_LOG=1 bun src/index.ts
  echo "[run-server] exited $? at $(date -Is), restarting in 2 s"
  sleep 2
done
