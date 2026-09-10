import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prepare = process.argv[2] === "--prepare";
if (process.getuid?.() !== 0 || /[\s%]/.test(root + process.execPath))
  throw new Error("STORAGE_INSTALL_ENVIRONMENT_INVALID");
if (!prepare) {
  execFileSync(
    process.execPath,
    [path.join(root, "scripts/storage-maintenance.mjs"), "verify-activation"],
    { cwd: root, stdio: "pipe" },
  );
}
mkdirSync("/etc/scalping-bot", { recursive: true, mode: 0o700 });
writeFileSync(
  "/etc/scalping-bot/storage-logrotate.conf",
  `${root}/logs/pm2/*.log {\n  daily\n  maxsize 2M\n  rotate 7\n  maxage 7\n  missingok\n  notifempty\n  compress\n  delaycompress\n  copytruncate\n  su root root\n}\n`,
  { mode: 0o600 },
);
for (const [name, command, schedule] of [
  ["maintenance", "maintenance", "OnBootSec=5min\nOnUnitActiveSec=5min"],
  ["backup", "backup", "OnCalendar=*-*-* 00:20:00 UTC\nPersistent=true"],
]) {
  const base = `scalper-storage-${name}`;
  const service = `[Unit]\nDescription=Scalper local storage ${name}\nAfter=postgresql.service\n\n[Service]\nType=oneshot\nWorkingDirectory=${root}\nExecStart=${process.execPath} ${root}/scripts/storage-maintenance.mjs ${command}\nEnvironment=PYTHONDONTWRITEBYTECODE=1\nUMask=0077\nNice=10\nTimeoutStartSec=600\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nReadWritePaths=${root}/.runtime ${root}/logs\n`;
  const timer = `[Unit]\nDescription=Scalper scheduled ${name}\n\n[Timer]\n${schedule}\nRandomizedDelaySec=30\n\n[Install]\nWantedBy=timers.target\n`;
  writeFileSync(`/etc/systemd/system/${base}.service`, service, {
    mode: 0o644,
  });
  writeFileSync(`/etc/systemd/system/${base}.timer`, timer, { mode: 0o644 });
}
execFileSync("systemctl", ["daemon-reload"], { stdio: "pipe" });
if (!prepare)
  execFileSync(
    "systemctl",
    [
      "enable",
      "--now",
      "scalper-storage-maintenance.timer",
      "scalper-storage-backup.timer",
    ],
    { stdio: "pipe" },
  );
process.stdout.write(
  prepare
    ? "Storage timers prepared but not enabled.\n"
    : "Storage timers enabled.\n",
);
