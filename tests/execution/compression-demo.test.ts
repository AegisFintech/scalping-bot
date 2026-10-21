import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type {
  AnalyticsRequest,
  MarketSnapshot,
} from "../../packages/contracts/src/index.js";
import {
  CompressionDemoClient,
  compressionDemoTransform,
  type ScalpScanReport,
} from "../../packages/strategy-candidates/src/compression-demo.js";
import { response, metadata } from "../helpers/breakout-candidate.js";

function snapshot(): MarketSnapshot {
  const request = JSON.parse(
    readFileSync("tests/fixtures/technical-context/request.json", "utf8"),
  ) as { request: AnalyticsRequest };
  const at = "2026-09-01T00:00:02.000Z";
  return {
    serverTime: at,
    capturedAt: at,
    observedSkewMs: 0,
    quote: { bid: "4443.4", ask: "4443.6", sourceTime: at, receivedAt: at },
    metadata: metadata(),
    candles: request.request.candles,
    orderBook: request.request.orderBook,
  };
}
function report(): ScalpScanReport {
  return {
    schemaVersion: "scalp-scan-report-1.0",
    execution_authority: false,
    promotion: "HOLD",
    input_sha256: "a".repeat(64),
    observed_at: snapshot().capturedAt,
    status: "OCO_CANDIDATE",
    reasons: [],
    pair: [0, 1],
    candidates: [
      {
        setup: "COMPRESSION_BREAKOUT",
        side: "BUY",
        order_type: "STOP_LIMIT",
        entry: "4444",
        invalidation: "4442",
        target: "4446",
        source_available_at: "2026-09-01T00:00:00Z",
        admission_until: "2026-09-01T00:01:00Z",
      },
      {
        setup: "COMPRESSION_BREAKOUT",
        side: "SELL",
        order_type: "STOP_LIMIT",
        entry: "4443",
        invalidation: "4445",
        target: "4441",
        source_available_at: "2026-09-01T00:00:00Z",
        admission_until: "2026-09-01T00:01:00Z",
      },
    ],
  };
}
function input() {
  return {
    snapshot: snapshot(),
    response: response(),
    atr: "4",
    maximumStopDistance: "10",
    report: report(),
    modeledCost: "0.1",
  };
}
describe("explicit compression demo adoption", () => {
  it("preserves model entries and historical input while deriving structural exits", () => {
    const value = input(),
      before = structuredClone(value);
    const result = compressionDemoTransform(value);
    expect(result.accepted).toBe(true);
    expect(result.response?.buy_stop.entry_price).toBe(
      value.response.buy_stop.entry_price,
    );
    expect(result.response?.sell_stop.entry_price).toBe(
      value.response.sell_stop.entry_price,
    );
    expect(result.response?.buy_stop.stop_loss).toBe("4442");
    expect(result.response?.buy_stop.risk_reward_ratio).toBe("1");
    expect(value).toEqual(before);
  });
  it.each([
    "no_pair",
    "same_index",
    "wrong_side",
    "wrong_family",
    "expired",
    "future",
    "snapshot",
    "far_model",
    "inward_model",
    "stop",
    "costs",
    "precision",
  ])("withholds %s without fallback", (fault) => {
    const v = structuredClone(input());
    const c = v.report.candidates[0]!;
    if (fault === "no_pair")
      Object.assign(v.report, { status: "NO_PAIR", pair: null });
    if (fault === "same_index") Object.assign(v.report, { pair: [0, 0] });
    if (fault === "wrong_side") Object.assign(c, { side: "SELL" });
    if (fault === "wrong_family") Object.assign(c, { setup: "TREND_PULLBACK" });
    if (fault === "expired")
      Object.assign(c, { admission_until: v.snapshot.capturedAt });
    if (fault === "future")
      Object.assign(c, { source_available_at: "2026-09-02T00:00:00Z" });
    if (fault === "snapshot")
      Object.assign(v.report, { observed_at: "2026-09-02T00:00:00Z" });
    if (fault === "far_model")
      Object.assign(v.response.buy_stop, { entry_price: "4446" });
    if (fault === "inward_model")
      Object.assign(v.response.buy_stop, { entry_price: "4443.9" });
    if (fault === "stop") v.maximumStopDistance = "0.1";
    if (fault === "costs") v.modeledCost = "1";
    if (fault === "precision") Object.assign(c, { invalidation: "4442.001" });
    expect(compressionDemoTransform(v).accepted).toBe(false);
  });
  it("requires loopback and rejects an unbound service response", async () => {
    expect(() => new CompressionDemoClient("https://example.com")).toThrow(
      "SCALP_LOOPBACK_REQUIRED",
    );
    const fetch = vi.fn(() => Promise.resolve(Response.json(report())));
    await expect(
      new CompressionDemoClient("http://127.0.0.1:8090", fetch).scan(
        snapshot(),
        "4",
      ),
    ).rejects.toThrow("SCALP_HTTP_PROVENANCE_INVALID");
  });
  it("rejects mismatched clocks even with a matching HTTP request digest", async () => {
    const fetch: typeof globalThis.fetch = vi.fn(
      (
        _url: Parameters<typeof globalThis.fetch>[0],
        init?: Parameters<typeof globalThis.fetch>[1],
      ) =>
        Promise.resolve(
          Response.json(
            { ...report(), observed_at: "2026-01-01T00:00:00Z" },
            {
              headers: {
                "x-scalp-request-sha256": createHash("sha256")
                  .update(typeof init?.body === "string" ? init.body : "")
                  .digest("hex"),
              },
            },
          ),
        ),
    );
    await expect(
      new CompressionDemoClient("http://127.0.0.1:8090", fetch).scan(
        snapshot(),
        "4",
      ),
    ).rejects.toThrow("SCALP_RESPONSE_INVALID");
  });
});
