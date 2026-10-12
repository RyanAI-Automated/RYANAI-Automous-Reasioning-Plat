#!/bin/sh
set -eu

if [ "${1:-}" = "nginx" ]; then
    echo "==> Configuring Nginx runtime environment..."

    : "${PORT:=80}"
    : "${API_HOST:=api}"
    : "${API_PORT:=3000}"

    # Validate PORT and API_PORT are valid TCP port numbers (1-65535)
    for value in "$PORT" "$API_PORT"; do
        case "$value" in
            ''|*[!0-9]*) 
                echo "Error: PORT and API_PORT must be integers from 1 to 65535" >&2
                exit 1 
                ;;
        esac
        if [ "$value" -lt 1 ] || [ "$value" -gt 65535 ]; then
            echo "Error: PORT and API_PORT must be integers from 1 to 65535" >&2
            exit 1
        fi
    done

    # Validate API_HOST format
    case "$API_HOST" in
        ''|*[!a-zA-Z0-9._-]*) 
            echo "Error: API_HOST must be a valid hostname or IP address" >&2
            exit 1 
            ;;
    esac

    export PORT API_HOST API_PORT

    echo "==> Substituting environment variables into Nginx configuration..."
    # Substitute only our settings; preserve Nginx internal variables such as $uri.
    envsubst '${PORT} ${API_HOST} ${API_PORT}' \
        < /etc/nginx/conf.d/default.conf.template \
        > /etc/nginx/conf.d/default.conf

    echo "==> Verifying Nginx configuration..."
    nginx -t
fi

echo "==> Starting Nginx..."
exec "$@"
