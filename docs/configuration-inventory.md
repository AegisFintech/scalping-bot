# Complete configuration inventory

Baseline `2ee59bb`: 176 assignments; current normal template: 20 (ISSUE-079).
This inventory classifies every former setting by its implemented disposition.
No environment setting controls an optimizer; bounded adaptive risk multipliers
are internal state, not operator knobs. Ports/paths/TLS remain deployment options.

- Secret or deployment identity: 31
- Obsolete setting: 30
- Internal engineering default: 105
- Essential operator choice / safety authorization: 6
- Broker-discovered value: 4
- Bounded adaptive strategy parameter: 0 environment assignments.

| Former setting                             | Category                                         | Implemented disposition                                   |
| ------------------------------------------ | ------------------------------------------------ | --------------------------------------------------------- |
| `APP_ENV`                                  | Secret or deployment identity                    | Advanced deployment override only.                        |
| `APP_NAME`                                 | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `LOG_LEVEL`                                | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `HOST`                                     | Secret or deployment identity                    | Advanced deployment override only.                        |
| `API_PORT`                                 | Secret or deployment identity                    | Advanced deployment override only.                        |
| `MARKET_DATA_PORT`                         | Secret or deployment identity                    | Advanced deployment override only.                        |
| `AI_ORCHESTRATOR_PORT`                     | Secret or deployment identity                    | Advanced deployment override only.                        |
| `DASHBOARD_PORT`                           | Secret or deployment identity                    | Advanced deployment override only.                        |
| `ANALYTICS_PORT`                           | Secret or deployment identity                    | Advanced deployment override only.                        |
| `TIMEZONE`                                 | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `INSTANCE_ID`                              | Secret or deployment identity                    | Normal template.                                          |
| `TRADING_MODE`                             | Essential operator choice / safety authorization | Normal template.                                          |
| `LIVE_TRADING_ENABLED`                     | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `LIVE_TRADING_ACKNOWLEDGEMENT`             | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `DEMO_TRADING_ENABLED`                     | Essential operator choice / safety authorization | Normal template.                                          |
| `DEMO_TRADING_ACKNOWLEDGEMENT`             | Essential operator choice / safety authorization | Normal template.                                          |
| `EMERGENCY_STOP`                           | Essential operator choice / safety authorization | Normal template.                                          |
| `EMERGENCY_STOP_FILE`                      | Secret or deployment identity                    | Advanced deployment override only.                        |
| `LIVE_ENABLEMENT_FILE`                     | Secret or deployment identity                    | Advanced deployment override only.                        |
| `SHADOW_MODE`                              | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `PAUSE_NEW_ANALYSES`                       | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `AUTOMATIC_ANALYSIS_ENABLED`               | Essential operator choice / safety authorization | Normal template.                                          |
| `AUTOMATIC_ANALYSIS_COMPLETED_LIMIT`       | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `AUTOMATIC_ANALYSIS_COMPLETED_BASELINE`    | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `AUTOMATIC_DEMO_CLOSED_TRADE_LIMIT`        | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `AUTOMATIC_DEMO_CLOSED_TRADE_BASELINE`     | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `SHUTDOWN_CANCEL_PENDING`                  | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `RUNTIME_CONTROL_POLL_SECONDS`             | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `ANALYSIS_INTERVAL_SECONDS`                | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `ANALYSIS_SCHEDULER_LEAD_MS`               | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `AUTOMATIC_ANALYSIS_START_WINDOW_SECONDS`  | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `AUTOMATIC_ANALYSIS_STALL_SECONDS`         | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MODEL_MINIMUM_CALL_BUDGET_SECONDS`        | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MODEL_POST_RESPONSE_RESERVE_SECONDS`      | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `TRADING_SYMBOL`                           | Secret or deployment identity                    | Normal template.                                          |
| `SYMBOL_DISCOVERY_ENABLED`                 | Broker-discovered value                          | Remove legacy override; broker metadata is authoritative. |
| `SYMBOL_ID`                                | Broker-discovered value                          | Remove legacy override; broker metadata is authoritative. |
| `ACCOUNT_ID`                               | Secret or deployment identity                    | Normal template.                                          |
| `ACCOUNT_TYPE`                             | Broker-discovered value                          | Remove legacy override; broker metadata is authoritative. |
| `ACCOUNT_KEY`                              | Secret or deployment identity                    | Normal template.                                          |
| `ACCOUNT_CURRENCY`                         | Broker-discovered value                          | Remove legacy override; broker metadata is authoritative. |
| `BLOCK_ON_MANUAL_SYMBOL_ORDERS`            | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `BLOCK_ON_MANUAL_SYMBOL_POSITIONS`         | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `CTRADER_CLIENT_ID`                        | Secret or deployment identity                    | Normal template.                                          |
| `CTRADER_CLIENT_SECRET`                    | Secret or deployment identity                    | Normal template.                                          |
| `CTRADER_ACCESS_TOKEN`                     | Secret or deployment identity                    | Normal template.                                          |
| `CTRADER_ACCESS_TOKEN_EXPIRES_AT`          | Secret or deployment identity                    | Advanced deployment override only.                        |
| `CTRADER_REFRESH_TOKEN`                    | Secret or deployment identity                    | Normal template.                                          |
| `CTRADER_TOKEN_STATE_FILE`                 | Secret or deployment identity                    | Advanced deployment override only.                        |
| `CTRADER_TOKEN_URL`                        | Secret or deployment identity                    | Advanced deployment override only.                        |
| `CTRADER_API_HOST`                         | Secret or deployment identity                    | Advanced deployment override only.                        |
| `CTRADER_API_PORT`                         | Secret or deployment identity                    | Advanced deployment override only.                        |
| `CTRADER_CONNECTION_MODE`                  | Secret or deployment identity                    | Advanced deployment override only.                        |
| `CTRADER_RECONNECT_MIN_MS`                 | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `CTRADER_RECONNECT_MAX_MS`                 | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `CTRADER_REQUEST_TIMEOUT_MS`               | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `DEMO_EXECUTION_RECOVERY_INTERVAL_SECONDS` | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `BARS_15M`                                 | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `BARS_5M`                                  | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `BARS_1M`                                  | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `USE_COMPLETED_CANDLES_ONLY`               | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MODEL_PAYLOAD_MODE`                       | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MODEL_FULL_CANDLE_LIMIT_15M`              | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MODEL_FULL_CANDLE_LIMIT_5M`               | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MODEL_FULL_CANDLE_LIMIT_1M`               | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MODEL_COMPACT_RAW_TAIL_15M`               | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MODEL_COMPACT_RAW_TAIL_5M`                | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MODEL_COMPACT_RAW_TAIL_1M`                | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MAX_CANDLE_SKEW_MS`                       | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `ATR_PERIOD`                               | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `ATR_SMOOTHING`                            | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `EMA_FAST_PERIOD`                          | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `EMA_SLOW_PERIOD`                          | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `EMA_SOURCE`                               | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `VWAP_ENABLED`                             | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `SESSION_VWAP_ENABLED`                     | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `ADX_ENABLED`                              | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `ADX_PERIOD`                               | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `RSI_ENABLED`                              | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `RSI_PERIOD`                               | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `BOLLINGER_ENABLED`                        | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `BOLLINGER_PERIOD`                         | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `BOLLINGER_STDDEV`                         | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `REALIZED_VOLATILITY_ENABLED`              | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `VOLUME_FEATURES_ENABLED`                  | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `SWING_STRUCTURE_ENABLED`                  | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `PERFORMANCE_MINIMUM_SAMPLES`              | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `PERFORMANCE_DECAY`                        | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `PERFORMANCE_ROLLING_TRADES`               | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `SWING_PIVOT_LEFT`                         | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `SWING_PIVOT_RIGHT`                        | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `SPREAD_FEATURES_ENABLED`                  | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `ORDER_BOOK_IMBALANCE_ENABLED`             | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `ORDER_BOOK_DEPTH`                         | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `ORDER_BOOK_SNAPSHOT_TIMEOUT_MS`           | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `ORDER_BOOK_MAX_AGE_MS`                    | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `SYMBOL_METADATA_MAX_AGE_MS`               | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MAX_QUOTE_AGE_MS`                         | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `ORDER_BOOK_AGGREGATION_ENABLED`           | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `ORDER_BOOK_AGGREGATION_WINDOWS`           | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `LOCAL_MARKET_RECORDING_ENABLED`           | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `LOCAL_MARKET_RECORD_DIRECTORY`            | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `LOCAL_MARKET_RECORD_INTERVAL_MS`          | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `LOCAL_MARKET_RECORD_SEGMENT_SECONDS`      | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `LOCAL_MARKET_RECORD_MAX_SEGMENTS`         | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `AI_BASE_URL`                              | Secret or deployment identity                    | Normal template.                                          |
| `AI_API_KEY`                               | Secret or deployment identity                    | Normal template.                                          |
| `AI_MODEL`                                 | Internal engineering default                     | Exact model pin in template; other models reject.         |
| `AI_API_STYLE`                             | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `AI_TIMEOUT_MS`                            | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `AI_MAX_RETRIES`                           | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `AI_TEMPERATURE`                           | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `AI_STRICT_JSON`                           | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `AI_SCHEMA_VERSION`                        | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `AI_MAX_INPUT_TOKENS`                      | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `AI_MAX_OUTPUT_TOKENS`                     | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `AI_REASONING_EFFORT`                      | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `AI_CIRCUIT_BREAKER_FAILURES`              | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `AI_CIRCUIT_BREAKER_RESET_SECONDS`         | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `BASE_RISK_PERCENT`                        | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MAX_RISK_PERCENT`                         | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MAX_DAILY_LOSS_PERCENT`                   | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `DAILY_RISK_TIMEZONE`                      | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `DAILY_BASELINE_CAPTURE_GRACE_SECONDS`     | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `INCLUDE_UNREALIZED_IN_DAILY_LOSS`         | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MIN_RISK_REWARD_RATIO`                    | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MAX_SLIPPAGE_BPS`                         | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MAX_SLIPPAGE_POINTS`                      | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `SPREAD_FILTER_MODE`                       | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `MAX_SPREAD_POINTS`                        | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MAX_SPREAD_ATR_RATIO`                     | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MAX_SPREAD_PERCENTILE`                    | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `SPREAD_PERCENTILE_MINIMUM_SAMPLES`        | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `SPREAD_SESSION_ABNORMAL_MULTIPLIER`       | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MAX_ORDERS_PER_DAY`                       | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `LOSS_COOLDOWN_SECONDS`                    | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `MAX_OPEN_POSITIONS_PER_SYMBOL`            | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `MAX_PENDING_ORDERS_PER_SYMBOL`            | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `ACCOUNT_EQUITY_FLOOR`                     | Obsolete setting                                 | Removed in fixed-risk-v2; ignored legacy value.           |
| `ORDER_EXPIRY_MIN_SECONDS`                 | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `ORDER_EXPIRY_MAX_SECONDS`                 | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `PREFERRED_ORDER_EXPIRY_SECONDS`           | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MIN_STOP_DISTANCE_POINTS`                 | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MAX_STOP_DISTANCE_ATR`                    | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MAX_ENTRY_DISTANCE_ATR`                   | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `ENTRY_LATENCY_BUFFER_ATR`                 | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `PREFERRED_MAX_ENTRY_DISTANCE_ATR`         | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `MAX_POSITION_NOTIONAL`                    | Obsolete setting                                 | Removed in v3; explicit migration required.               |
| `MAX_MARGIN_USAGE_PERCENT`                 | Internal engineering default                     | Fixed collateral check; legacy 1% override rejects.       |
| `PAPER_ACCOUNT_EQUITY`                     | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `PAPER_ACCOUNT_BALANCE`                    | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `PAPER_AVAILABLE_MARGIN`                   | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `PAPER_MARGIN_PER_NATIVE_VOLUME`           | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `PAPER_SLIPPAGE_POINTS`                    | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `DATABASE_URL`                             | Secret or deployment identity                    | Normal template.                                          |
| `DATABASE_POOL_MIN`                        | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `DATABASE_POOL_MAX`                        | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `DATABASE_SSL_MODE`                        | Secret or deployment identity                    | Advanced deployment override only.                        |
| `BETTERSTACK_SOURCE_TOKEN`                 | Secret or deployment identity                    | Normal template.                                          |
| `BETTERSTACK_INGESTING_HOST`               | Secret or deployment identity                    | Normal template.                                          |
| `BETTERSTACK_ENABLED`                      | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `BETTERSTACK_HEARTBEAT_URL`                | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `OTEL_EXPORTER_OTLP_ENDPOINT`              | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `OTEL_EXPORTER_OTLP_HEADERS`               | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `LOCAL_LOG_DIR`                            | Secret or deployment identity                    | Advanced deployment override only.                        |
| `LOCAL_LOG_MAX_SIZE_MB`                    | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `LOCAL_LOG_MAX_FILES`                      | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `METRICS_ENABLED`                          | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `METRICS_PORT`                             | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `SERVER_STATS_INTERVAL_SECONDS`            | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `NETWORK_INTERFACE`                        | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `DASHBOARD_CONTROL_TOKEN`                  | Secret or deployment identity                    | Normal template.                                          |
| `TRUST_PROXY`                              | Internal engineering default                     | Fixed versioned policy; conflicting legacy values reject. |
| `GH_REPO`                                  | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `GH_USER`                                  | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
| `GH_PAT`                                   | Obsolete setting                                 | Remove during review; no current runtime behavior.        |
