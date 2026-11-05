#!/bin/sh
# Fail early when an explicitly configured additional CA bundle is unavailable.
# Node reads NODE_EXTRA_CA_CERTS only when the application process starts.
set -eu

if [ -n "${NODE_EXTRA_CA_CERTS:-}" ]; then
  if [ ! -r "$NODE_EXTRA_CA_CERTS" ]; then
    echo "NODE_EXTRA_CA_CERTS is set, but its CA bundle is missing or unreadable; refusing to start." >&2
    exit 1
  fi

  if ! grep -q -- '-----BEGIN CERTIFICATE-----' "$NODE_EXTRA_CA_CERTS"; then
    echo "NODE_EXTRA_CA_CERTS must reference a PEM-encoded certificate bundle; refusing to start." >&2
    exit 1
  fi
fi

exec "$@"
