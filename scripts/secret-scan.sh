#!/bin/sh
set -eu
scan_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec node "$scan_root/scripts/secret-scan.mjs"
