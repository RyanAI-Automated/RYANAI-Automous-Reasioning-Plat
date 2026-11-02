#!/bin/sh
# Render the nginx template with validated upstream settings, then exec nginx.
# The envsubst allow-list leaves nginx variables such as $host and $scheme intact.
set -eu

: "\${PORT:=80}"
: "\${API_HOST:=api}"
: "\${API_PORT:=3000}"
export PORT API_HOST API_PORT

validate_port() {
  name="$1"
  value="$2"
  case "$value" in
    ""|*[!0-9]*)
      echo "Invalid \${name}: expected a numeric TCP port" >&2
      exit 64
      ;;
  esac
  if [ "$value" -lt 1 ] || [ "$value" -gt 65535 ]; then
    echo "Invalid \${name}: port must be between 1 and 65535" >&2
    exit 64
  fi
}

validate_port PORT "$PORT"
validate_port API_PORT "$API_PORT"

case "$API_HOST" in
  ""|*[!A-Za-z0-9._-]*)
    echo "Invalid API_HOST: use a DNS name, IPv4 address, or service name" >&2
    exit 64
    ;;
esac

template=/etc/nginx/conf.d/default.conf.template
output=/etc/nginx/conf.d/default.conf
if [ ! -r "$template" ]; then
  echo "nginx configuration template is missing or unreadable: $template" >&2
  exit 66
fi
if ! command -v envsubst >/dev/null 2>&1; then
  echo "envsubst is required but was not found in the nginx image" >&2
  exit 69
fi

umask 077
temporary_output="$(mktemp "\${output}.XXXXXX")"
trap 'rm -f "$temporary_output"' EXIT HUP INT TERM
envsubst '\${PORT} \${API_HOST} \${API_PORT}' < "$template" > "$temporary_output"
mv "$temporary_output" "$output"
trap - EXIT HUP INT TERM

exec "$@"
