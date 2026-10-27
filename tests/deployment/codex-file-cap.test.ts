import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

const unit = readFileSync("systemd/scalper-codex-entry.service", "utf8");
const match = /^LimitFSIZE=(\d+)M$/m.exec(unit);

it("lets persistent Codex state grow beyond the old cap while preserving history and a finite bound", () => {
  expect(match).not.toBeNull();
  const bytes = Number(match![1]) * 1024 ** 2;
  const result = spawnSync(
    ".venv/bin/python",
    [
      "-c",
      `
import errno, json, os, resource, signal, subprocess, sys, tempfile
from pathlib import Path
cap=int(sys.argv[1])
with tempfile.TemporaryDirectory() as d:
 p=Path(d)/'history'
 p.write_bytes(b'preserved-history')
 code="""import os,resource,signal,sys
signal.signal(signal.SIGXFSZ,signal.SIG_IGN)
cap=int(sys.argv[2]);resource.setrlimit(resource.RLIMIT_FSIZE,(cap,cap))
fd=os.open(sys.argv[1],os.O_RDWR)
try:os.pwrite(fd,b'x'*4096,33554432);os.fsync(fd)
except OSError as e:sys.exit(e.errno)
finally:os.close(fd)
"""
 old=subprocess.run([sys.executable,'-c',code,str(p),str(32*1024**2)])
 assert old.returncode==errno.EFBIG
 assert p.read_bytes()==b'preserved-history'
 new=subprocess.run([sys.executable,'-c',code,str(p),str(cap)])
 assert new.returncode==0
 with p.open('rb') as f:
  assert f.read(17)==b'preserved-history'
  f.seek(33554432);assert f.read(4096)==b'x'*4096
 assert p.stat().st_size<cap
 print(json.dumps({'oldCapRejected':True,'newCapAccepted':True,'historyPreserved':True,'finiteCap':cap}))
`,
      String(bytes),
    ],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    oldCapRejected: true,
    newCapAccepted: true,
    historyPreserved: true,
    finiteCap: 536870912,
  });
});

it("retains worker isolation and separate memory, process and swap limits", () => {
  for (const directive of [
    "MemoryMax=512M",
    "TasksMax=64",
    "MemorySwapMax=0",
    "NoNewPrivileges=true",
    "ProtectSystem=strict",
    "ProtectHome=true",
    "PrivateTmp=true",
  ])
    expect(unit.split("\n")).toContain(directive);
});
