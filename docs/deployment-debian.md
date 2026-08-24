# Debian Deployment

## Layout and identities

- Releases: `/opt/ctrader-ai-scalper/releases/<release-id>` (read-only to runtime user after deploy)
- Active application: atomic symlink `/opt/ctrader-ai-scalper/current`
- Environment: `/etc/ctrader-ai-scalper/ctrader-ai-scalper.env` (`root:ctrader-scalper`, mode `0640`)
- Runtime: `/run/ctrader-ai-scalper` or configured persistent safety directory
- Logs: `/var/log/ctrader-ai-scalper`
- Service user/group: `ctrader-scalper`, no login shell, no sudo

The live enablement sentinel must persist at the explicitly reviewed path; do not place it in a directory systemd recreates automatically if the operator expects manual persistence. The install script never creates it.

## Installation

```bash
sudo ./scripts/setup-debian.sh
release_id=20260824T000000Z
release_dir=/opt/ctrader-ai-scalper/releases/$release_id
sudo install -d -o ctrader-scalper -g ctrader-scalper -m 0750 "$release_dir"
sudo rsync -a --delete --exclude .git --exclude .env --exclude .venv --exclude node_modules ./ "$release_dir/"
sudo -u ctrader-scalper npm --prefix "$release_dir" ci
sudo -u ctrader-scalper npm --prefix "$release_dir" run build
sudo -u ctrader-scalper python3 -m venv "$release_dir/.venv"
sudo -u ctrader-scalper "$release_dir/.venv/bin/pip" install -r "$release_dir/requirements.lock"
sudo chown -R root:ctrader-scalper "$release_dir"
sudo chmod -R go-w "$release_dir"
```

Run tests and migrations from the release directory before switching the
`current` symlink. Use a separate migration credential where possible. After all
checks pass:

```bash
sudo ln -sfn "$release_dir" /opt/ctrader-ai-scalper/current.new
sudo mv -Tf /opt/ctrader-ai-scalper/current.new /opt/ctrader-ai-scalper/current
```

## Database

```bash
sudo --preserve-env=DATABASE_URL -u ctrader-scalper npm --prefix /opt/ctrader-ai-scalper/current run db:migrate
```

Run the command from a root shell that loaded the protected migration
environment; do not place the URL on the command line. Prefer a protected
wrapper/credential mechanism and verify migration status and backup/restore
before service start.

## systemd

Install reviewed units from `systemd/`, run `systemctl daemon-reload`, then enable analytics, market data, AI, execution, and dashboard. Units use restart backoff, graceful `SIGTERM`, filesystem protections, private temp space, loopback listeners, capability restrictions, and dependency ordering. The database remains an external readiness dependency.

```bash
sudo ./scripts/install-systemd.sh
sudo systemctl daemon-reload
sudo systemctl enable --now ctrader-ai-scalper.target
```

Inspect with `systemctl status`, `journalctl -u`, and local health endpoints. Restart never implies reconciliation success; execution readiness remains false until broker/account state is certain.

## PM2 alternative

For an existing PM2-managed VPS, `ecosystem.config.cjs` runs the same five
services from production build output and keeps every listener on loopback. Run
`npm run build`, create `logs/pm2`, start the ecosystem, save the process list,
and verify the PM2 systemd startup unit can resurrect it. The ecosystem contains
no secrets; Node and the Python launcher load the protected local environment at
runtime. Do not run PM2 and the project systemd units at the same time.

PM2 process restart is not readiness. After every restart, verify all health
endpoints, the execution denial/eligibility reason codes, market freshness, and
account reconciliation. Remote Streamlit access still requires an authenticated
TLS proxy such as a Cloudflare Tunnel protected by Cloudflare Access; a tunnel
route alone is not authentication.

## Health and shutdown

API liveness reports that the process can answer; readiness is service-specific.
Execution readiness reflects startup safety status, while order eligibility is
reported separately by its status/cycle response. `SIGTERM` handlers in market
data and execution stop their listeners; execution also stops scheduling,
optionally cancels strategy pending orders according to policy, and disconnects
from the broker/database. Framework-managed services are bounded by systemd's
stop timeout.

## Backups and restore

Use Neon point-in-time/branch capabilities plus scheduled logical backups appropriate to the plan. Encrypt exports; test restore into an isolated database; verify migration ledger, row counts, constraints, and unresolved orders. Restored data must never connect automatically to a live account.

## Update and rollback

1. Activate emergency stop and pause analyses; safely cancel/reconcile strategy pending orders.
2. Build/test a versioned release directory.
3. Back up and apply forward migrations.
4. Stop services, switch release symlink, start in dependency order, verify readiness/reconciliation.
5. Roll back code only when schema remains compatible. Database rollback requires an explicit reviewed migration/data plan.
6. Leave live disabled until a new manual review/acknowledgement.
