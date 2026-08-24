#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo ./scripts/install-systemd.sh" >&2
  exit 1
fi

for unit in systemd/*.service systemd/*.target; do
  install -o root -g root -m 0644 "$unit" "/etc/systemd/system/$(basename "$unit")"
done
systemctl daemon-reload
echo "Units installed but not enabled. Review environment and run: systemctl enable --now ctrader-ai-scalper.target"
