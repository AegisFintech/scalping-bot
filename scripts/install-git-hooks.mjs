import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error || result.status !== 0)
    throw new Error("HOOK_INSTALL_GIT_FAILED");
  return result.stdout.trim();
}
const configured = spawnSync("git", ["config", "--get", "core.hooksPath"], {
  encoding: "utf8",
});
if (configured.status !== 0 && configured.status !== 1)
  throw new Error("HOOK_INSTALL_CONFIG_FAILED");
if (configured.stdout.trim() && configured.stdout.trim() !== ".githooks")
  throw new Error("HOOK_INSTALL_EXISTING_HOOKS_PATH");
if (
  !configured.stdout.trim() &&
  existsSync(git(["rev-parse", "--git-path", "hooks/pre-push"]))
)
  throw new Error("HOOK_INSTALL_EXISTING_PRE_PUSH");
if (!existsSync(".githooks/pre-push"))
  throw new Error("HOOK_INSTALL_WRONG_DIRECTORY");
git(["config", "--local", "core.hooksPath", ".githooks"]);
console.log("Installed pre-push documentation and local Graphify gate.");
