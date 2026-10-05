import "dotenv/config";
import { spawn } from "node:child_process";
import path from "node:path";
const service = process.argv[2];
const root = process.cwd();
const definitions = {
  analytics: [
    "-m",
    "uvicorn",
    "python.analytics.api:app",
    "--host",
    "127.0.0.1",
    "--port",
    process.env.ANALYTICS_PORT ?? "8090",
  ],
  dashboard: [
    "-m",
    "streamlit",
    "run",
    path.join(root, "apps/dashboard/app.py"),
    "--server.headless",
    "true",
    "--server.address",
    "127.0.0.1",
    "--server.port",
    process.env.DASHBOARD_PORT ?? "8501",
    "--browser.gatherUsageStats",
    "false",
  ],
};
if (!Object.hasOwn(definitions, service))
  throw new Error("PYTHON_SERVICE_INVALID");
const child = spawn(path.join(root, ".venv/bin/python"), definitions[service], {
  cwd: root,
  env: { ...process.env, PYTHONPATH: root, PYTHONDONTWRITEBYTECODE: "1" },
  stdio: "inherit",
});
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    stopping = true;
    child.kill(signal);
  });
child.once("error", () => {
  process.stderr.write("PYTHON_SERVICE_START_FAILED\n");
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? (stopping ? 0 : 1);
});
