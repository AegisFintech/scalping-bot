#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo ./scripts/setup-debian.sh" >&2
  exit 1
fi

apt-get update
apt-get install -y --no-install-recommends ca-certificates curl build-essential python3 python3-venv rsync postgresql-client

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 is required. Install it from a trusted Debian-compatible source, then rerun." >&2
  exit 1
fi

node_major=$(node -p "process.versions.node.split('.')[0]")
if [ "$node_major" -ne 22 ]; then
  echo "Node.js 22 is required; found $(node --version)." >&2
  exit 1
fi

if ! getent group ctrader-scalper >/dev/null; then
  addgroup --system ctrader-scalper
fi
if ! id ctrader-scalper >/dev/null 2>&1; then
  adduser --system --ingroup ctrader-scalper --home /var/lib/ctrader-ai-scalper \
    --no-create-home --shell /usr/sbin/nologin ctrader-scalper
fi

install -d -o root -g ctrader-scalper -m 0750 /etc/ctrader-ai-scalper
install -d -o root -g ctrader-scalper -m 0750 /opt/ctrader-ai-scalper
install -d -o root -g ctrader-scalper -m 0750 /opt/ctrader-ai-scalper/releases
install -d -o ctrader-scalper -g ctrader-scalper -m 0700 /var/lib/ctrader-ai-scalper
install -d -o ctrader-scalper -g ctrader-scalper -m 0750 /var/log/ctrader-ai-scalper

if [ ! -e /etc/ctrader-ai-scalper/ctrader-ai-scalper.env ]; then
  install -o root -g ctrader-scalper -m 0640 systemd/ctrader-ai-scalper.env.template \
    /etc/ctrader-ai-scalper/ctrader-ai-scalper.env
fi

# A default emergency-stop sentinel is safe to create. This script never creates live-enabled.
install -o ctrader-scalper -g ctrader-scalper -m 0600 /dev/null \
  /var/lib/ctrader-ai-scalper/emergency-stop

echo "Base Debian setup complete. Populate the protected environment, deploy a reviewed release, and run tests."
