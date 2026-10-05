// Explicitly selected release only; this file is never used by the current deployment.
const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const release = process.env.SCALPER_RELEASE_DIR;
const node = process.env.SCALPER_NODE_BINARY;
const environmentFile = process.env.SCALPER_ENV_FILE;
if (
  ![release, node, environmentFile].every(
    (value) => typeof value === "string" && path.isAbsolute(value),
  )
)
  throw new Error("RELEASE_SUPERVISOR_CONFIGURATION_REQUIRED");
if (
  !fs.statSync(environmentFile).isFile() ||
  (fs.statSync(environmentFile).mode & 0o077) !== 0
)
  throw new Error("RELEASE_PROTECTED_ENVIRONMENT_REQUIRED");
const verified = spawnSync(
  node,
  [path.join(release, "scripts/prepare-release.mjs"), "verify", release],
  { stdio: "ignore", timeout: 60000 },
);
if (verified.status !== 0)
  throw new Error("RELEASE_SUPERVISOR_VERIFICATION_FAILED");
const base = {
  cwd: release,
  interpreter: "none",
  exec_mode: "fork",
  instances: 1,
  autorestart: true,
  watch: false,
  min_uptime: "10s",
  max_restarts: 20,
  restart_delay: 5000,
  kill_timeout: 45000,
  env: {
    NODE_ENV: "production",
    APP_ENV: "production",
    DOTENV_CONFIG_PATH: environmentFile,
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONPATH: release,
  },
};
function service(name, entry, args = []) {
  return {
    ...base,
    name,
    namespace: "ctrader-ai-scalper",
    script: node,
    args: [path.join(release, entry), ...args],
    out_file: path.join(release, "logs/pm2", name + ".out.log"),
    error_file: path.join(release, "logs/pm2", name + ".error.log"),
  };
}
module.exports = {
  apps: [
    service("scalper-analytics", "scripts/run-python-release.mjs", [
      "analytics",
    ]),
    service(
      "scalper-market-data",
      "dist/apps/market-data-service/src/index.js",
    ),
    service("scalper-ai", "dist/apps/ai-orchestrator/src/index.js"),
    service("scalper-execution", "dist/apps/execution-service/src/index.js"),
    service("scalper-dashboard", "scripts/run-python-release.mjs", [
      "dashboard",
    ]),
  ],
};
