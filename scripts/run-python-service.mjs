import "dotenv/config";

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const service = process.argv[2];
const definitions = {
  analytics: {
    executable: path.join(root, ".venv/bin/uvicorn"),
    arguments: [
      "python.analytics.api:app",
      "--host",
      "127.0.0.1",
      "--port",
      process.env.ANALYTICS_PORT ?? "8090",
    ],
  },
  dashboard: {
    executable: path.join(root, ".venv/bin/streamlit"),
    arguments: [
      "run",
      "apps/dashboard/app.py",
      "--server.headless",
      "true",
      "--server.address",
      "127.0.0.1",
      "--server.port",
      process.env.DASHBOARD_PORT ?? "8501",
      "--browser.gatherUsageStats",
      "false",
    ],
  },
};

const definition = definitions[service];
if (definition === undefined) {
  process.stderr.write("PYTHON_SERVICE_INVALID\n");
  process.exit(2);
}

const child = spawn(definition.executable, definition.arguments, {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stopping = true;
    child.kill(signal);
  });
}

child.once("error", () => {
  process.stderr.write("PYTHON_SERVICE_START_FAILED\n");
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal !== null && !stopping) {
    process.stderr.write("PYTHON_SERVICE_EXITED_BY_SIGNAL\n");
  }
  process.exitCode = code ?? (stopping ? 0 : 1);
});
