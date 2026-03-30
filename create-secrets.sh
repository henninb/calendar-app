#!/usr/bin/env bash
set -euo pipefail

# Pipe gopass directly to podman — secrets never touch a shell variable.
# Run once before the first `./run-container.sh`, or after credentials rotate.

_create() {
  local name="$1"
  local gopass_path="$2"
  if podman secret inspect "$name" &>/dev/null; then
    podman secret rm "$name"
  fi
  gopass show -o "$gopass_path" | podman secret create "$name" -
  echo "Created: $name"
}

_create DB_USERNAME          postgresql.bhenning.com/username
_create DB_PASSWORD          postgresql.bhenning.com/password
_create GOOGLE_CLIENT_ID     gmail/brian.henning/client_id
_create GOOGLE_CLIENT_SECRET gmail/brian.henning/client_secret
