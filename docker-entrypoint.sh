#!/bin/sh
# Fill the nginx template with the settings from the environment, then start nginx.
# The variable list keeps nginx variables such as $host and $http_upgrade as they are.
set -eu

: "${PORT:=80}" "${API_HOST:=api}" "${API_PORT:=3000}"
export PORT API_HOST API_PORT

envsubst '${PORT} ${API_HOST} ${API_PORT}' \
  < /etc/nginx/conf.d/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec "$@"
