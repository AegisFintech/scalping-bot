"""Pinned sandbox transport. Expected answers are never mounted in the candidate runtime."""

import json
import runpy
from pathlib import Path

if __name__ == "__main__":
    data = json.loads(Path("/input.json").read_bytes())
    report = runpy.run_path("/work/" + data["module"])["report"]
    print(json.dumps([report(rows) for rows in data["cases"]], sort_keys=True, allow_nan=False))
