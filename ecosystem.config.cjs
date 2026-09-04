const path = require("node:path");

const root = __dirname;
const logs = path.join(root, "logs", "pm2");

function service(name, overrides = {}) {
  return {
    name,
    namespace: "ctrader-ai-scalper",
    cwd: root,
    exec_mode: "fork",
    instances: 1,
    autorestart: true,
    watch: false,
    min_uptime: "10s",
    max_restarts: 20,
    restart_delay: 5000,
    kill_timeout: 45000,
    listen_timeout: 15000,
    time: true,
    merge_logs: true,
    out_file: path.join(logs, `${name}.out.log`),
    error_file: path.join(logs, `${name}.error.log`),
    env: {
      NODE_ENV: "production",
      APP_ENV: "production",
      STRATEGY_VERSION: "0.1.0-actionable-oco-auto-demo.43",
      CODE_VERSION: "0.1.0-actionable-oco-auto-demo.43",
      AUTOMATIC_ANALYSIS_COMPLETED_LIMIT: "0",
      AUTOMATIC_ANALYSIS_COMPLETED_BASELINE: "0",
      AUTOMATIC_DEMO_CLOSED_TRADE_LIMIT: "0",
      AUTOMATIC_DEMO_CLOSED_TRADE_BASELINE: "0",
      AUTOMATIC_ANALYSIS_START_WINDOW_SECONDS: "10",
      AUTOMATIC_ANALYSIS_STALL_SECONDS: "180",
      ANALYSIS_SCHEDULER_LEAD_MS: "1000",
      MODEL_MINIMUM_CALL_BUDGET_SECONDS: "40",
      MODEL_POST_RESPONSE_RESERVE_SECONDS: "5",
      MODEL_COMPACT_RAW_TAIL_1M: "30",
      MODEL_COMPACT_RAW_TAIL_5M: "18",
      MODEL_COMPACT_RAW_TAIL_15M: "12",
      MAX_ENTRY_DISTANCE_ATR: "2.5",
      ENTRY_LATENCY_BUFFER_ATR: "0.25",
      PREFERRED_MAX_ENTRY_DISTANCE_ATR: "0.75",
      MIN_RISK_REWARD_RATIO: "0.5",
      MIN_EXPECTED_NET_TO_FEES_RATIO: "1",
      ORDER_EXPIRY_MIN_SECONDS: "60",
      ORDER_EXPIRY_MAX_SECONDS: "120",
      PREFERRED_ORDER_EXPIRY_SECONDS: "60",
      AI_REASONING_EFFORT: "low",
      LOCAL_MARKET_RECORDING_ENABLED: "true",
      LOCAL_MARKET_RECORD_DIRECTORY: ".runtime/market-data",
      LOCAL_MARKET_RECORD_INTERVAL_MS: "250",
      LOCAL_MARKET_RECORD_SEGMENT_SECONDS: "300",
      LOCAL_MARKET_RECORD_MAX_SEGMENTS: "2016",
    },
    ...overrides,
  };
}

function nodeService(name, entry, overrides = {}) {
  return service(name, {
    script: process.execPath,
    args: [path.join(root, entry)],
    interpreter: "none",
    ...overrides,
  });
}

function pythonService(name, serviceName) {
  return service(name, {
    script: process.execPath,
    args: [path.join(root, "scripts/run-python-service.mjs"), serviceName],
    interpreter: "none",
    kill_timeout: 30000,
  });
}

module.exports = {
  apps: [
    pythonService("scalper-analytics", "analytics"),
    nodeService(
      "scalper-market-data",
      "dist/apps/market-data-service/src/index.js",
    ),
    nodeService("scalper-ai", "dist/apps/ai-orchestrator/src/index.js"),
    nodeService(
      "scalper-execution",
      "dist/apps/execution-service/src/index.js",
    ),
    pythonService("scalper-dashboard", "dashboard"),
  ],
};
