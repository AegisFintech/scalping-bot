import { describe, expect, it } from "vitest";

import {
  auditEventPayload,
  retryDelayMs,
  type AuditOutboxRow,
} from "../../apps/execution-service/src/observability-outbox.js";

function row(): AuditOutboxRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    audit_event_id: "22222222-2222-4222-8222-222222222222",
    attempt_count: 2,
    occurred_at: new Date("2026-08-24T00:00:00.000Z"),
    severity: "info",
    service: "execution-service",
    instance_id: "test-instance",
    environment: "test",
    trading_mode: "demo",
    trace_id: null,
    request_id: "request-correlation",
    analysis_id: "33333333-3333-4333-8333-333333333333",
    order_group_id: null,
    symbol: "XAUUSD",
    event_name: "model_completed",
    outcome: "accepted",
    reason_code: null,
    retry_count: 0,
    schema_version: "1.0",
    model_version: "test-model",
    duration_ms: 123,
    details: {
      decision: "NO_TRADE",
      authorization: "Bearer must-not-leak",
      nested: { access_token: "must-not-leak" },
    },
  };
}

describe("observability outbox", () => {
  it("builds a stable correlated payload and redacts nested secrets", () => {
    const payload = JSON.stringify(auditEventPayload(row()));
    expect(payload).toContain("22222222-2222-4222-8222-222222222222");
    expect(payload).toContain("33333333-3333-4333-8333-333333333333");
    expect(payload).toContain("model_completed");
    expect(payload).toContain("[REDACTED]");
    expect(payload).not.toContain("must-not-leak");
    expect(payload).not.toContain("broker_order_id");
    expect(payload).not.toContain("account_key");
  });

  it("uses bounded exponential retry and rejects invalid configuration", () => {
    expect(retryDelayMs(1, 5_000, 300_000)).toBe(5_000);
    expect(retryDelayMs(3, 5_000, 300_000)).toBe(20_000);
    expect(retryDelayMs(100, 5_000, 300_000)).toBe(300_000);
    expect(() => retryDelayMs(0, 5_000, 300_000)).toThrow(
      "OBSERVABILITY_ATTEMPT_COUNT_INVALID",
    );
    expect(() => retryDelayMs(1, 10_000, 5_000)).toThrow(
      "OBSERVABILITY_RETRY_RANGE_INVALID",
    );
  });
});
