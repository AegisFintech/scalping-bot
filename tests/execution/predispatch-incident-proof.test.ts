import { describe, expect, it } from "vitest";
import {
  assertPredispatchIncidentEvidence,
  executionIsStopped,
  INCIDENT_ACTIVATION_SHA256,
  INCIDENT_RELEASE_COMMIT,
  INCIDENT_RELEASE_SOURCE,
  INCIDENT_GATEWAY_SHA256,
  INCIDENT_RECEIPT_SHA256,
  type PredispatchIncidentEvidence,
} from "../../apps/execution-service/src/predispatch-incident-proof.js";

const evidence: PredispatchIncidentEvidence = {
  executionStopped: true,
  analysisPaused: true,
  inflightRequests: 0,
  mode: "demo",
  symbol: "XAUUSD",
  strategy: "0.8.0-model-scalp.1-codex.1",
  analysisState: "REJECTED",
  activeGroups: 1,
  cancellationReason: "ANALYSIS_EXPIRED",
  executionType: "STOP_LIMIT",
  zeroFilled: true,
  receiptSha256: INCIDENT_RECEIPT_SHA256,
  activationSha256: INCIDENT_ACTIVATION_SHA256,
  activationAt: "2026-10-28T12:47:41.271Z",
  activationCommit: INCIDENT_RELEASE_COMMIT,
  activationSource: INCIDENT_RELEASE_SOURCE,
  activationVerified: true,
  gatewaySha256: INCIDENT_GATEWAY_SHA256,
  processStartedAt: "2026-10-28T12:47:21.962Z",
  processRestarts: 0,
  receiptCapturedAt: "2026-10-29T01:27:20.468Z",
  createdAt: "2026-10-28T23:16:11.329Z",
  rejectedAt: "2026-10-28T23:16:11.375Z",
  intentAudits: 1,
  rejectionAudits: 1,
  orderCount: 1,
  groupState: "RECONCILIATION_REQUIRED",
  orderState: "CANCEL_PENDING",
  side: "BUY",
  timeInForce: "GTD",
  submitted: false,
  brokerId: false,
  fills: 0,
  positions: 0,
  trades: 0,
  brokerEvents: 0,
  eventVariants: 0,
  localProofs: 0,
  otherUnresolvedEvents: 0,
  historyFrom: "2026-10-28T23:11:11.329Z",
  historyUntil: "2026-10-29T02:00:00.000Z",
  observedAt: "2026-10-29T02:00:01.000Z",
  historyOrders: 0,
  historyDeals: 0,
  historyOrdersHasMore: false,
  historyDealsHasMore: false,
  openOrders: 0,
  openPositions: 0,
  brokerAccountBound: true,
};

describe("historical pre-dispatch incident evidence", () => {
  it("requires exactly one stopped supervisor entry and no execution process", () => {
    expect(
      executionIsStopped(
        [{ name: "scalper-execution", pm2_env: { status: "stopped" } }],
        0,
      ),
    ).toBe(true);
    expect(
      executionIsStopped(
        [{ name: "scalper-execution", pm2_env: { status: "online" } }],
        0,
      ),
    ).toBe(false);
    expect(
      executionIsStopped(
        [{ name: "scalper-execution", pm2_env: { status: "stopped" } }],
        1,
      ),
    ).toBe(false);
    expect(executionIsStopped([], 0)).toBe(false);
    expect(
      executionIsStopped(
        [{ name: "scalper-execution" }, { name: "scalper-execution" }],
        0,
      ),
    ).toBe(false);
  });
  it("accepts only the pinned incident with complete fresh evidence", () => {
    expect(() => assertPredispatchIncidentEvidence(evidence)).not.toThrow();
  });
  it.each([
    { executionStopped: false },
    { analysisPaused: false },
    { inflightRequests: 1 },
    { mode: "live" },
    { symbol: "OTHER" },
    { strategy: "other" },
    { analysisState: "ACCEPTED" },
    { activeGroups: 2 },
    { cancellationReason: "unknown" },
    { executionType: "LIMIT" },
    { zeroFilled: false },
    { receiptSha256: "0" },
    { activationSha256: "0" },
    { activationAt: "2026-10-28T23:16:12Z" },
    { activationCommit: "different" },
    { activationSource: "different" },
    { activationVerified: false },
    { gatewaySha256: "0" },
    { processRestarts: 1 },
    { processStartedAt: "2026-10-28T23:16:12Z" },
    { receiptCapturedAt: "2026-10-28T23:16:11Z" },
    { createdAt: "2026-10-28T23:16:12Z" },
    { rejectedAt: "2026-10-28T23:16:12Z" },
    { intentAudits: 0 },
    { rejectionAudits: 2 },
    { orderCount: 2 },
    { groupState: "CLOSED" },
    { orderState: "UNKNOWN" },
    { side: "SELL" },
    { timeInForce: "GTC" },
    { submitted: true },
    { brokerId: true },
    { fills: 1 },
    { positions: 1 },
    { trades: 1 },
    { brokerEvents: 1 },
    { eventVariants: 1 },
    { localProofs: 1 },
    { otherUnresolvedEvents: 1 },
    { historyFrom: "2026-10-28T23:16:11Z" },
    { historyUntil: "2026-10-28T23:16:11Z" },
    { observedAt: "2026-10-29T02:00:16Z" },
    { historyOrders: 1 },
    { historyDeals: 1 },
    { historyOrdersHasMore: true },
    { historyDealsHasMore: true },
    { openOrders: 1 },
    { openPositions: 1 },
    { brokerAccountBound: false },
  ])("rejects incomplete or contradictory evidence %#", (patch) => {
    expect(() =>
      assertPredispatchIncidentEvidence({ ...evidence, ...patch }),
    ).toThrow("PREDISPATCH_INCIDENT_EVIDENCE_INCOMPLETE");
  });
});
