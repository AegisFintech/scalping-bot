import "dotenv/config";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(
  path.join(root, ".venv/bin/python"),
  ["-m", "python.operations.storage", ...process.argv.slice(2)],
  { cwd: root, env: process.env, stdio: "inherit" },
);
child.on("error", () => {
  process.stderr.write("STORAGE_PROCESS_START_FAILED\n");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => child.kill(signal));
