from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from python.analytics.models import AnalyticsRequest
from python.analytics.service import analyze


def read_requests(path: Path) -> list[AnalyticsRequest]:
    requests: list[AnalyticsRequest] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            payload: Any = json.loads(line)
            requests.append(AnalyticsRequest.model_validate(payload))
        except (json.JSONDecodeError, ValueError) as error:
            raise ValueError(f"invalid replay record at line {line_number}: {error}") from error
    return requests


def main() -> None:
    parser = argparse.ArgumentParser(description="Replay immutable analytics requests")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--mode", choices=["replay"], default="replay")
    args = parser.parse_args()
    for request in read_requests(args.input):
        response = analyze(request, now=request.analysis_time)
        print(response.model_dump_json(by_alias=True))


if __name__ == "__main__":
    main()
