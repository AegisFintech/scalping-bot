import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function git(args, optional = false) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    if (optional) return null;
    throw new Error("PUSH_GIT_EVIDENCE_UNAVAILABLE");
  }
  return result.stdout.trim();
}
try {
  const lines = readFileSync(0, "utf8").trim().split("\n").filter(Boolean);
  let update = false;
  for (const line of lines) {
    const [localRef, head, remoteRef, old, ...extra] = line.trim().split(/\s+/);
    if (
      extra.length ||
      !localRef ||
      !remoteRef ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head ?? "") ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(old ?? "")
    )
      throw new Error("PUSH_REF_PROTOCOL_INVALID");
    if (
      /^0+$/.test(head) ||
      head === old ||
      !remoteRef.startsWith("refs/heads/")
    )
      continue;
    let base = old;
    if (/^0+$/.test(old)) {
      const main = git(
        ["rev-parse", "--verify", "refs/remotes/origin/main"],
        true,
      );
      if (!main) throw new Error("PUSH_BASELINE_UNAVAILABLE_FETCH_ORIGIN_MAIN");
      base = git(["merge-base", main, head]);
    }
    const commits = git(["rev-list", "--no-merges", `${base}..${head}`])
      .split("\n")
      .filter(Boolean);
    for (const commit of commits) {
      const changed = new Set(
        git([
          "diff-tree",
          "--root",
          "--no-commit-id",
          "--name-only",
          "-r",
          commit,
        ]).split("\n"),
      );
      if (!changed.has("README.md") || !changed.has("AGENTS.md"))
        throw new Error(
          `PUSH_DOCUMENTATION_REQUIRED:${commit.slice(0, 12)}: update README.md and AGENTS.md in each new commit`,
        );
    }
    update = true;
  }
  if (update) {
    if (git(["status", "--porcelain", "--untracked-files=no"]))
      throw new Error("PUSH_TRACKED_WORKTREE_DIRTY");
    const result = spawnSync("graphify", ["update", "."], {
      stdio: ["ignore", "inherit", "inherit"],
      timeout: 120_000,
    });
    if (result.error || result.status !== 0)
      throw new Error("PUSH_GRAPHIFY_FAILED_INSTALL_OR_REPAIR_GRAPHIFY");
    console.log(
      "Pre-push: per-commit README/AGENTS and local AST Graphify update passed.",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "PUSH_CHECK_FAILED");
  process.exitCode = 1;
}
