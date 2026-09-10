import "dotenv/config";
import { spawn } from "node:child_process";
import { chmod } from "node:fs/promises";
import path from "node:path";

const output = process.argv[2];
if (!output || !path.isAbsolute(output) || !process.env.DATABASE_URL) {
  process.stderr.write("BACKUP_ABSOLUTE_PATH_AND_CONFIGURATION_REQUIRED\n");
  process.exit(1);
}
let url;
try {
  url = new URL(process.env.DATABASE_URL);
} catch {
  process.exit(1);
}
if (!["postgres:", "postgresql:"].includes(url.protocol)) process.exit(1);
process.umask(0o077);
const child = spawn(
  "pg_dump",
  ["--format=custom", "--no-owner", "--no-privileges", "--file=" + output],
  {
    env: {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port || "5432",
      PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGSSLMODE: "verify-full",
      PGSSLROOTCERT:
        url.searchParams.get("sslrootcert") ||
        "/etc/ssl/certs/ca-certificates.crt",
    },
    stdio: ["ignore", "ignore", "ignore"],
  },
);
child.on("error", () => {
  process.stderr.write("DATABASE_BACKUP_START_FAILED\n");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  if (code !== 0) {
    process.stderr.write("DATABASE_BACKUP_FAILED\n");
    process.exitCode = 1;
    return;
  }
  void chmod(output, 0o600)
    .then(() =>
      process.stdout.write(
        "Database dump created; pair it with verified artifacts before recovery.\n",
      ),
    )
    .catch(() => {
      process.stderr.write("DATABASE_BACKUP_PERMISSION_FAILED\n");
      process.exitCode = 1;
    });
});
