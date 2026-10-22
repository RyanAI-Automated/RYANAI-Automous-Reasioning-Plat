#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e
# Exit immediately if an unset variable is used
set -u

# ---------------------------------------------------------
# Secure Entrypoint for Node.js / Fastify Containers
# ---------------------------------------------------------

# 1. Log startup initialization (Useful for Grafana Alloy / Loki ingestion)
echo "[INFO] Starting container initialization..."
echo "[INFO] Node version: $(node -v)"

# 2. Enforce non-root execution for security compliance
if [ "$(id -u)" = '0' ]; then
  echo "[WARN] Container is running as root. It is highly recommended to run RyanAI services as a non-root user (e.g., 'node')."
  # If using gosu or su-exec, you would drop privileges here:
  # exec gosu node "$BASH_SOURCE" "$@"
fi

# 3. Execute the main process
# Using 'exec' is critical. It replaces this bash shell with the target process (PID 1).
# This ensures orchestration signals (like SIGTERM from Kubernetes or Docker)
# directly reach the Node.js process so Fastify can gracefully close database connections.
if [ "${1#-}" != "${1}" ] || [ -z "$(command -v "${1}")" ]; then
  # If the first argument is a flag (e.g., --inspect) or not a recognized command, prepend 'node'
  set -- node "$@"
fi

echo "[INFO] Executing command: $*"
exec "$@"
