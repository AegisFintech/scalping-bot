const path = require("node:path");

const root = __dirname;
const logs = path.join(root, "logs", "pm2");

function service(name, overrides = {}) {
  return {
    name,
    namespace: "ctrader-ai-scalper",
    cwd: root,
    exec_mode: "fork",
    instances: 1,
    autorestart: true,
    watch: false,
    min_uptime: "10s",
    max_restarts: 20,
    restart_delay: 5000,
    kill_timeout: 45000,
    listen_timeout: 15000,
    time: true,
    merge_logs: true,
    out_file: path.join(logs, `${name}.out.log`),
    error_file: path.join(logs, `${name}.error.log`),
    env: {
      NODE_ENV: "production",
      APP_ENV: "production",
      STRATEGY_VERSION: "0.1.0-actionable-oco-auto-demo.25",
      CODE_VERSION: "0.1.0-actionable-oco-auto-demo.25",
    },
    ...overrides,
  };
}

function nodeService(name, entry, overrides = {}) {
  return service(name, {
    script: process.execPath,
    args: [path.join(root, entry)],
    interpreter: "none",
    ...overrides,
  });
}

function pythonService(name, serviceName) {
  return service(name, {
    script: process.execPath,
    args: [path.join(root, "scripts/run-python-service.mjs"), serviceName],
    interpreter: "none",
    kill_timeout: 30000,
  });
}

module.exports = {
  apps: [
    pythonService("scalper-analytics", "analytics"),
    nodeService(
      "scalper-market-data",
      "dist/apps/market-data-service/src/index.js",
    ),
    nodeService("scalper-ai", "dist/apps/ai-orchestrator/src/index.js"),
    nodeService(
      "scalper-execution",
      "dist/apps/execution-service/src/index.js",
    ),
    pythonService("scalper-dashboard", "dashboard"),
  ],
};
