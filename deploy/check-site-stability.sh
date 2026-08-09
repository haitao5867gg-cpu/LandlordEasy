#!/bin/bash
# Repeatedly verify public HTTPS availability and certificate validation.
# Usage: bash deploy/check-site-stability.sh [url] [count] [interval_seconds]

set -u

URL="${1:-https://landlordeasy.cn/}"
COUNT="${2:-50}"
INTERVAL="${3:-1}"
CONNECT_TIMEOUT=5
MAX_TIME=15
failures=0
error_file=$(mktemp)
trap 'rm -f "$error_file"' EXIT

printf 'Checking %s (%s requests, %ss interval)\n' "$URL" "$COUNT" "$INTERVAL"

for ((i = 1; i <= COUNT; i++)); do
  : > "$error_file"
  if result=$(curl --silent --show-error --output /dev/null \
    --connect-timeout "$CONNECT_TIMEOUT" --max-time "$MAX_TIME" \
    --write-out '%{http_code} %{time_total} %{remote_ip} %{ssl_verify_result}' \
    "$URL" 2>"$error_file"); then
    read -r status elapsed remote_ip ssl_verify <<< "$result"
    if [[ "$status" == "200" && "$ssl_verify" == "0" ]]; then
      printf '[%02d/%02d] OK status=%s time=%ss ip=%s tls_verify=%s\n' \
        "$i" "$COUNT" "$status" "$elapsed" "$remote_ip" "$ssl_verify"
    else
      failures=$((failures + 1))
      printf '[%02d/%02d] FAIL status=%s time=%ss ip=%s tls_verify=%s\n' \
        "$i" "$COUNT" "$status" "$elapsed" "$remote_ip" "$ssl_verify"
    fi
  else
    failures=$((failures + 1))
    printf '[%02d/%02d] FAIL curl=%s\n' "$i" "$COUNT" "$(tr '\n' ' ' < "$error_file")"
  fi

  if ((i < COUNT)); then
    sleep "$INTERVAL"
  fi
done

printf 'Summary: total=%s success=%s failures=%s\n' "$COUNT" "$((COUNT - failures))" "$failures"
((failures == 0))
