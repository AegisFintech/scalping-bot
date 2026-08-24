from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from python.analytics.models import Candle
from python.backtest.engine import BacktestConfig, OrderLeg, simulate_oco


def _json_default(value: object) -> str:
    if isinstance(value, (Decimal, datetime)):
        return str(value)
    raise TypeError(f"unsupported value: {type(value).__name__}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Conservative candle OCO backtest")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    payload: Any = json.loads(args.input.read_text(encoding="utf-8"))
    candles = [Candle.model_validate(item) for item in payload["candles"]]
    buy = OrderLeg(
        "BUY",
        Decimal(payload["buy"]["entry"]),
        Decimal(payload["buy"]["stop_loss"]),
        Decimal(payload["buy"]["take_profit"]),
        datetime.fromisoformat(payload["buy"]["expires_at"]),
    )
    sell = OrderLeg(
        "SELL",
        Decimal(payload["sell"]["entry"]),
        Decimal(payload["sell"]["stop_loss"]),
        Decimal(payload["sell"]["take_profit"]),
        datetime.fromisoformat(payload["sell"]["expires_at"]),
    )
    config = BacktestConfig(
        tick_size=Decimal(payload["config"]["tick_size"]),
        slippage_points=Decimal(payload["config"].get("slippage_points", "0")),
        spread_points=Decimal(payload["config"].get("spread_points", "0")),
        latency_bars=int(payload["config"].get("latency_bars", 0)),
    )
    result = simulate_oco(candles, buy, sell, config)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(asdict(result), default=_json_default, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
