#!/bin/sh
set -eu
API_URL="${API_URL:-${VITE_API_URL:-}}"
printf 'window.__LL_API__ = "%s";\n' "$API_URL" > /usr/share/nginx/html/config.js
exec nginx -g 'daemon off;'
