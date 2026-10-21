import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const checker = path.resolve("scripts/check-push.mjs");
const installer = path.resolve("scripts/install-git-hooks.mjs");
const directories: string[] = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((p) => rmSync(p, { recursive: true, force: true })),
);
function fixture() {
  const cwd = mkdtempSync(path.join(tmpdir(), "push-maintenance-"));
  directories.push(cwd);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(path.join(cwd, "README.md"), "base\n");
  writeFileSync(path.join(cwd, "AGENTS.md"), "base\n");
  git("add", ".");
  git("commit", "-m", "base");
  const base = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", base);
  const bin = path.join(cwd, "bin");
  mkdirSync(bin);
  writeFileSync(
    path.join(bin, "graphify"),
    '#!/bin/sh\ntest "$1" = update && test "$2" = . || exit 4\ntouch graph-ran\nexit "${FIXTURE_GRAPH_EXIT:-0}"\n',
    { mode: 0o755 },
  );
  git("add", "bin");
  git("commit", "--amend", "--no-edit");
  const start = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", start);
  function commit(docs = true) {
    writeFileSync(path.join(cwd, "code.txt"), String(Math.random()));
    if (docs)
      for (const name of ["README.md", "AGENTS.md"])
        writeFileSync(path.join(cwd, name), String(Math.random()));
    git("add", ".");
    git("commit", "-m", "update");
    return git("rev-parse", "HEAD");
  }
  function run(head: string, old = start, extraEnv = {}) {
    return spawnSync(process.execPath, [checker], {
      cwd,
      encoding: "utf8",
      input: `refs/heads/test ${head} refs/heads/test ${old}\n`,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        ...extraEnv,
      },
    });
  }
  return { cwd, git, start, commit, run };
}
describe("per-push maintenance", () => {
  it("updates the graph after committed documentation passes", () => {
    const f = fixture();
    expect(f.run(f.commit()).status).toBe(0);
    expect(existsSync(path.join(f.cwd, "graph-ran"))).toBe(true);
  });
  it("uses origin/main for a first branch push", () => {
    const f = fixture();
    expect(f.run(f.commit(), "0".repeat(40)).status).toBe(0);
  });
  it("rejects missing documentation before touching the graph", () => {
    const f = fixture();
    const r = f.run(f.commit(false));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("PUSH_DOCUMENTATION_REQUIRED");
    expect(existsSync(path.join(f.cwd, "graph-ran"))).toBe(false);
  });
  it("checks every commit rather than only the final combined diff", () => {
    const f = fixture();
    f.commit(false);
    const r = f.run(f.commit());
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("PUSH_DOCUMENTATION_REQUIRED");
  });
  it("blocks dirty tracked files and graph failures", () => {
    const f = fixture();
    const head = f.commit();
    expect(f.run(head, f.start, { FIXTURE_GRAPH_EXIT: "3" }).stderr).toContain(
      "PUSH_GRAPHIFY_FAILED",
    );
    writeFileSync(path.join(f.cwd, "README.md"), "uncommitted");
    expect(f.run(head).stderr).toContain("PUSH_TRACKED_WORKTREE_DIRTY");
  });
  it("does not run graph updates on branch deletion", () => {
    const f = fixture();
    expect(f.run("0".repeat(40)).status).toBe(0);
    expect(existsSync(path.join(f.cwd, "graph-ran"))).toBe(false);
  });
  it("fails closed when the new-branch baseline is unavailable", () => {
    const f = fixture();
    f.git("update-ref", "-d", "refs/remotes/origin/main");
    expect(f.run(f.commit(), "0".repeat(40)).stderr).toContain(
      "PUSH_BASELINE_UNAVAILABLE",
    );
  });
  it("refuses to overwrite an existing hook and installs idempotently", () => {
    const f = fixture();
    mkdirSync(path.join(f.cwd, ".githooks"));
    writeFileSync(path.join(f.cwd, ".githooks/pre-push"), "#!/bin/sh\n");
    const existing = path.join(f.cwd, ".git/hooks/pre-push");
    writeFileSync(existing, "#!/bin/sh\n");
    const install = () =>
      spawnSync(process.execPath, [installer], {
        cwd: f.cwd,
        encoding: "utf8",
      });
    expect(install().stderr).toContain("HOOK_INSTALL_EXISTING_PRE_PUSH");
    rmSync(existing);
    expect(install().status).toBe(0);
    expect(install().status).toBe(0);
    expect(f.git("config", "--get", "core.hooksPath")).toBe(".githooks");
  });
});
