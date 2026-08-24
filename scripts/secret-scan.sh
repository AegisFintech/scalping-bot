#!/bin/sh
set -eu

scan_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$scan_root"

status=0
# Scan only files that could enter source control. Intentionally ignored local
# secrets (for example .env and .runtime token state) must never be echoed by
# this command.
if git ls-files --cached --others --exclude-standard -z | xargs -0 -r rg -n --hidden \
  --glob '!.env.sample' --glob '!systemd/*.template' \
  '(?i)^(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|database_url|authorization)[[:space:]]*=[[:space:]]*[^[:space:]#]{8,}'; then
  echo "Potential populated secret assignment found." >&2
  status=1
fi
if git ls-files --cached --others --exclude-standard -z | xargs -0 -r rg -n --hidden \
  --glob '!tests/**' '(?:sk-[A-Za-z0-9_-]{20,}|Bearer[[:space:]]+[A-Za-z0-9._~+/=-]{24,})'; then
  echo "Potential API credential pattern found." >&2
  status=1
fi
if git ls-files --cached --others --exclude-standard -z | xargs -0 -r rg -n --hidden \
  -- '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'; then
  echo "Private key material found." >&2
  status=1
fi
exit "$status"
