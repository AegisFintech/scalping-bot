import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { storageServiceConfig } from "./storage-service-config.mjs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const prepare = args.includes("--prepare");
const values = new Map();
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (key === "--prepare") continue;
  if (
    !["--env-file", "--runtime", "--logs"].includes(key) ||
    values.has(key) ||
    !args[i + 1]
  )
    throw new Error("STORAGE_INSTALL_ARGUMENT_INVALID");
  values.set(key, args[++i]);
}
const runtime = values.get("--runtime") ?? path.join(root, ".runtime");
const logs = values.get("--logs") ?? path.join(root, "logs");
const envFile =
  values.get("--env-file") ??
  process.env.DOTENV_CONFIG_PATH ??
  path.join(root, ".env");
const config = storageServiceConfig({
  root,
  node: process.execPath,
  runtime,
  logs,
  envFile,
});
if (process.getuid?.() !== 0 || /[\s%]/.test(root + process.execPath))
  throw new Error("STORAGE_INSTALL_ENVIRONMENT_INVALID");
if (!prepare) {
  execFileSync(
    process.execPath,
    [
      path.join(root, "scripts/storage-maintenance.mjs"),
      "verify-activation",
      "--runtime",
      runtime,
    ],
    {
      cwd: root,
      stdio: "pipe",
      env: { ...process.env, DOTENV_CONFIG_PATH: envFile },
    },
  );
}
mkdirSync("/etc/scalping-bot", { recursive: true, mode: 0o700 });
writeFileSync("/etc/scalping-bot/storage-logrotate.conf", config.logrotate, {
  mode: 0o600,
});
for (const [name, command, schedule] of [
  ["maintenance", "maintenance", "OnBootSec=5min\nOnUnitActiveSec=5min"],
  ["backup", "backup", "OnCalendar=*-*-* 00:20:00 UTC\nPersistent=true"],
]) {
  const base = `scalper-storage-${name}`;
  const service = config.service(command);
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
