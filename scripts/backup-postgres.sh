#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: DATABASE_URL=... $0 /explicit/backup/path.dump" >&2
  exit 1
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

output=$1
case "$output" in
  /*) ;;
  *) echo "Backup path must be absolute" >&2; exit 1 ;;
esac

umask 077
pg_dump --format=custom --no-owner --no-privileges --file="$output" "$DATABASE_URL"
chmod 0600 "$output"
echo "Encrypted storage is still required for $output"
