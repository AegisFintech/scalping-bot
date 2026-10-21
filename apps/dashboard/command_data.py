"""Bounded presentation reads, bound to an exact account / symbol / mode."""

import json
from collections.abc import Callable
from typing import Any


def command_data(
    rows: Callable[..., list[dict[str, Any]]], scope: tuple[Any, ...]
) -> dict[str, Any]:
    focus = rows(
        """SELECT ar.id AS analysis_id, ar.candle_snapshot_id, ar.analysis_time,
             ar.state AS analysis_state, og.state AS group_state, sc.plan,
             sc.captured_at, sc.available_at, sc.valid_until, sv.version AS strategy_version,
             CASE WHEN octet_length(ce.request_text)<=128000
               THEN ce.request_text END AS provider_input,
             ind.features, ind.acceptable AS analytics_acceptable, ind.generated_at
           FROM analysis_runs ar
           JOIN strategy_versions sv ON sv.id=ar.strategy_version_id
           LEFT JOIN order_groups og ON og.analysis_id=ar.id
           LEFT JOIN scenario_contexts sc ON sc.id=og.context_plan_id
           LEFT JOIN context_provider_evidence ce ON ce.context_id=sc.id
           LEFT JOIN LATERAL (SELECT features,acceptable,generated_at FROM indicator_snapshots
             WHERE candle_snapshot_id=ar.candle_snapshot_id
             ORDER BY generated_at DESC LIMIT 1) ind ON true
           WHERE ar.account_id=%s AND ar.symbol_id=%s AND ar.mode=%s
           ORDER BY CASE WHEN og.state NOT IN ('CLOSED','FAILED','EXPIRED') THEN 0
             WHEN og.id IS NOT NULL THEN 1 ELSE 2 END, ar.analysis_time DESC LIMIT 1""",
        scope,
    )
    data: dict[str, Any] = {"evidence": {}, "candles": [], "validations": [], "risks": []}
    if focus:
        evidence = dict(focus[0])
        analysis_id = evidence.pop("analysis_id")
        candle_id = evidence.pop("candle_snapshot_id")
        provider_input = evidence.pop("provider_input", None)
        data["evidence"] = evidence
        if candle_id:
            data["candles"] = rows(
                """SELECT timeframe,start_time,end_time,open,high,low,close,volume,complete
                 FROM (SELECT c.*,row_number() OVER
                   (PARTITION BY timeframe ORDER BY start_time DESC) AS n
                   FROM decision_candles c WHERE snapshot_id=%s
                     AND timeframe IN ('M1','M5','M15') AND complete=true) c
                 WHERE n<=80 ORDER BY timeframe,start_time""",
                (candle_id,),
            )
        if isinstance(provider_input, str):
            try:
                parsed = json.loads(provider_input)
                exact = provider_candles(parsed)
                if exact:
                    data["candles"] = exact
                    evidence["chart_source"] = "Recorded Codex input"
                    evidence["chart_at"] = evidence.get("captured_at")
            except (ValueError, TypeError, KeyError):
                pass  # Retain explicitly labelled execution candles; never guess model input.
        evidence.setdefault("chart_source", "Recorded execution snapshot")
        evidence.setdefault("chart_at", evidence.get("analysis_time"))
        data["validations"] = rows(
            "SELECT stage,accepted,reason_codes,validated_at FROM validation_results "
            "WHERE analysis_id=%s ORDER BY validated_at DESC LIMIT 12",
            (analysis_id,),
        )
        data["risks"] = rows(
            "SELECT side,approved,normalized_volume,estimated_margin,risk_budget,"
            "reason_codes FROM risk_decisions WHERE analysis_id=%s ORDER BY side LIMIT 2",
            (analysis_id,),
        )
    data["curve"] = rows(
        """SELECT closed_at,realized_pnl AS net_pnl FROM
          (SELECT t.closed_at,t.realized_pnl FROM trades t
           JOIN order_groups og ON og.id=t.order_group_id
           JOIN analysis_runs ar ON ar.id=og.analysis_id
           WHERE ar.account_id=%s AND ar.symbol_id=%s AND t.mode=%s
           ORDER BY t.closed_at DESC,t.id DESC LIMIT 300) t ORDER BY closed_at""",
        scope,
    )
    data["market"] = rows(
        """SELECT bid,ask,spread,source_time,complete,discontinuity,imbalance_top5
        FROM order_book_snapshots WHERE symbol_id=%s ORDER BY source_time DESC LIMIT 1""",
        (scope[1],),
    )
    return data


def provider_candles(payload: Any) -> list[dict[str, Any]]:
    """Decode only the bounded exact recorded provider candle grid."""
    expected = [
        "startTime",
        "endTime",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "complete",
        "qualityFlags",
    ]
    if not isinstance(payload, dict) or not isinstance(payload.get("candles"), list):
        raise ValueError("PROVIDER_GRID_UNAVAILABLE")
    output: list[dict[str, Any]] = []
    seen = set()
    for series in payload["candles"]:
        frame = series["timeframe"]
        if frame not in {"M1", "M5", "M15"} or frame in seen or series.get("columns") != expected:
            raise ValueError("PROVIDER_GRID_INVALID")
        seen.add(frame)
        if not isinstance(series.get("rows"), list) or not 1 <= len(series["rows"]) <= 288:
            raise ValueError("PROVIDER_GRID_INVALID")
        for row in series["rows"][-80:]:
            if not isinstance(row, list) or len(row) != 9 or row[7] is not True:
                raise ValueError("PROVIDER_COMPLETED_REQUIRED")
            output.append(
                dict(
                    zip(
                        [
                            "start_time",
                            "end_time",
                            "open",
                            "high",
                            "low",
                            "close",
                            "volume",
                            "complete",
                            "quality_flags",
                        ],
                        row,
                        strict=True,
                    ),
                    timeframe=frame,
                )
            )
    if seen != {"M1", "M5", "M15"}:
        raise ValueError("PROVIDER_TIMEFRAMES_REQUIRED")
    return output
