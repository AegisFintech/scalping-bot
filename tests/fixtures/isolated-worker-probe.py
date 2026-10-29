import json
import os
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from python.research import isolated_worker as w

raw = json.loads(Path(__file__).with_name("trust.json").read_text())
raw["runtime"] = Path(raw["runtime"])
raw["verifier"] = Path(raw["verifier"])
trust = w.WorkerTrust(**raw)
checks = {
    "containment": """import os,socket,pathlib
assert os.geteuid()!=0
assert os.getenv("SECRET_CANARY") is None
for name in ["/root","/etc","/run/postgresql","/opt/scalper-isolation-probe421"]:
 assert not pathlib.Path(name).exists(),name
for name in ["/verify.py","/usr/bin/python3","/work/python/research/experiments/probe.py"]:
 try: pathlib.Path(name).write_bytes(b"overwrite")
 except OSError: pass
 else: raise AssertionError("writable")
s=socket.socket();s.settimeout(.2)
try: s.connect(("1.1.1.1",53))
except OSError: pass
else: raise AssertionError("network reachable")
assert socket.if_nameindex()==[(1,"lo")]
print("contained")
""",
    "memory_limit": (
        'try:\n x=bytearray(1024**3)\nexcept MemoryError: print("bounded")\n'
        'else: raise AssertionError("unbounded")\n'
    ),
    "file_limit": (
        'from pathlib import Path\ntry: Path("/tmp/large").write_bytes(b"x"*2097152)\n'
        'except OSError: print("bounded")\nelse: raise AssertionError("unbounded")\n'
    ),
    "output_limit": 'print("x"*70000)',
    "process_limit": """import os,signal,time
children=[]
limited=False
try:
 for _ in range(40):
  try: pid=os.fork()
  except BlockingIOError:
   limited=True
   break
  if pid==0:
   time.sleep(30)
   os._exit(0)
  children.append(pid)
finally:
 for pid in children: os.kill(pid,signal.SIGKILL)
 for pid in children: os.waitpid(pid,0)
assert limited and len(children)<32
print("bounded")
""",
    "timeout": "import time\ntime.sleep(10)",
    "timeout_descendant": "import os,time\nos.fork()\ntime.sleep(10)",
}
results = {}
group = Path("/sys/fs/cgroup") / Path("/proc/self/cgroup").read_text().strip()[4:]


def processes():
    return set(map(int, (group / "cgroup.procs").read_text().split()))


assert processes() == {os.getpid()}, "PROBE_REQUIRES_EXCLUSIVE_UNIT"
peak = [1]
stop = threading.Event()


def observe():
    while not stop.wait(0.01):
        peak[0] = max(peak[0], len(processes()))


for name, code in checks.items():
    files = {"python/research/experiments/probe.py": code.encode()}
    w.TIMEOUT_SECONDS = 0.3 if name == "timeout" else 2 if name == "timeout_descendant" else 30
    observer = None
    if name == "timeout_descendant":
        observer = threading.Thread(target=observe)
        observer.start()
    try:
        result = w.run(files, w.bundle_digest(files), trust)
        results[name] = {"exitCode": result.exit_code, "output": result.output.decode()[:1000]}
    except ValueError as e:
        results[name] = {"error": str(e)}
    finally:
        if observer:
            stop.set()
            observer.join()
    deadline = time.monotonic() + 2
    while processes() != {os.getpid()} and time.monotonic() < deadline:
        time.sleep(0.01)
    assert processes() == {os.getpid()}, "WORKER_DESCENDANTS_REMAIN"
assert peak[0] >= 5, "DESCENDANT_TIMEOUT_NOT_OBSERVED"
expected = {
    "containment": {"exitCode": 0, "output": "contained\n"},
    "memory_limit": {"exitCode": 0, "output": "bounded\n"},
    "file_limit": {"exitCode": 0, "output": "bounded\n"},
    "output_limit": {"error": "WORKER_OUTPUT_LIMIT"},
    "process_limit": {"exitCode": 0, "output": "bounded\n"},
    "timeout": {"error": "WORKER_TIMEOUT"},
    "timeout_descendant": {"error": "WORKER_TIMEOUT"},
}
assert results == expected, "WORKER_CONTAINMENT_PROBE_FAILED"
print(
    json.dumps(
        {
            "schemaVersion": "isolated-worker-probe-1.0",
            "checks": results,
            "descendantsGoneBetweenChecks": True,
            "descendantTimeoutPeakProcesses": peak[0],
            "runtimeSha256": trust.runtime_sha256,
            "verifierSha256": trust.verifier_sha256,
            "workerSha256": w.digest(Path(w.__file__).read_bytes()),
            "brokerAuthority": False,
            "publishAuthority": False,
            "qualificationAuthority": False,
        }
    )
)
