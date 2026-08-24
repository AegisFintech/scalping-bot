#!/bin/sh
set -eu

check() {
  name=$1
  url=$2
  if curl --fail --silent --show-error --max-time 5 "$url" >/dev/null; then
    echo "$name: ready"
  else
    echo "$name: NOT READY" >&2
    return 1
  fi
}

status=0
check analytics http://127.0.0.1:8090/health/ready || status=1
check market-data http://127.0.0.1:8081/health/ready || status=1
check ai http://127.0.0.1:8082/health/ready || status=1
check execution http://127.0.0.1:8080/health/ready || status=1
exit "$status"
