/** One historical incident only. Inputs must come from the trusted collector. */
export const INCIDENT_RECEIPT_SHA256 =
  "50e1b6522b623c36a95138faebc6e12898e58d1c73758d30cab93f5282729611";
export const INCIDENT_GATEWAY_SHA256 =
  "6aadc3847e1afdece95460a08baaa185b39e6754f63f3bc2aa745c9dbca39f3c";
export const INCIDENT_ACTIVATION_SHA256 =
  "fd20e326bc78acc1ff4148d5399041e52e14ecb952f9f8997fc810eb0eb830dc";
export const INCIDENT_RELEASE_COMMIT =
  "aebb1deec26509402a6250464d45be0350068fe7";
export const INCIDENT_RELEASE_SOURCE =
  "87b975640872522c44575491d4df4ed7f2f7efba3b97e305464c7d7ed5e8c69a";
const CREATED = Date.parse("2026-10-28T23:16:11.329Z");
const REJECTED = Date.parse("2026-10-28T23:16:11.375Z");

export function executionIsStopped(
  supervisor: unknown,
  matchingProcesses: number,
): boolean {
  if (!Array.isArray(supervisor) || matchingProcesses !== 0) return false;
  const entries: unknown[] = supervisor;
  const matches = entries.filter(
    (item: unknown) =>
      typeof item === "object" &&
      item !== null &&
      "name" in item &&
      item.name === "scalper-execution",
  );
  const item: unknown = matches[0];
  return (
    matches.length === 1 &&
    typeof item === "object" &&
    item !== null &&
    "pm2_env" in item &&
    typeof item.pm2_env === "object" &&
    item.pm2_env !== null &&
    "status" in item.pm2_env &&
    item.pm2_env.status === "stopped"
  );
}

export interface PredispatchIncidentEvidence {
  readonly executionStopped: boolean;
  readonly analysisPaused: boolean;
  readonly inflightRequests: number;
  readonly mode: string;
  readonly symbol: string;
  readonly strategy: string;
  readonly analysisState: string;
  readonly activeGroups: number;
  readonly cancellationReason: string;
  readonly executionType: string;
  readonly zeroFilled: boolean;
  readonly receiptSha256: string;
  readonly activationSha256: string;
  readonly activationAt: string;
  readonly activationCommit: string;
  readonly activationSource: string;
  readonly activationVerified: boolean;
  readonly gatewaySha256: string;
  readonly processStartedAt: string;
  readonly processRestarts: number;
  readonly receiptCapturedAt: string;
  readonly createdAt: string;
  readonly rejectedAt: string;
  readonly intentAudits: number;
  readonly rejectionAudits: number;
  readonly orderCount: number;
  readonly groupState: string;
  readonly orderState: string;
  readonly side: string;
  readonly timeInForce: string;
  readonly submitted: boolean;
  readonly brokerId: boolean;
  readonly fills: number;
  readonly positions: number;
  readonly trades: number;
  readonly brokerEvents: number;
  readonly eventVariants: number;
  readonly localProofs: number;
  readonly otherUnresolvedEvents: number;
  readonly historyFrom: string;
  readonly historyUntil: string;
  readonly observedAt: string;
  readonly historyOrders: number;
  readonly historyDeals: number;
  readonly historyOrdersHasMore: boolean;
  readonly historyDealsHasMore: boolean;
  readonly openOrders: number;
  readonly openPositions: number;
  readonly brokerAccountBound: boolean;
}

/** Failure does not authorize any state change or imply a broker outcome. */
export function assertPredispatchIncidentEvidence(
  e: PredispatchIncidentEvidence,
): void {
  const start = Date.parse(e.processStartedAt);
  const captured = Date.parse(e.receiptCapturedAt);
  const activated = Date.parse(e.activationAt);
  const from = Date.parse(e.historyFrom);
  const until = Date.parse(e.historyUntil);
  const observed = Date.parse(e.observedAt);
  if (
    e.executionStopped !== true ||
    e.analysisPaused !== true ||
    e.inflightRequests !== 0 ||
    e.mode !== "demo" ||
    e.symbol !== "XAUUSD" ||
    e.strategy !== "0.8.0-model-scalp.1-codex.1" ||
    e.analysisState !== "REJECTED" ||
    e.activeGroups !== 1 ||
    e.cancellationReason !== "ANALYSIS_EXPIRED" ||
    e.executionType !== "STOP_LIMIT" ||
    e.zeroFilled !== true ||
    e.receiptSha256 !== INCIDENT_RECEIPT_SHA256 ||
    e.activationSha256 !== INCIDENT_ACTIVATION_SHA256 ||
    e.activationCommit !== INCIDENT_RELEASE_COMMIT ||
    e.activationSource !== INCIDENT_RELEASE_SOURCE ||
    e.activationVerified !== true ||
    e.gatewaySha256 !== INCIDENT_GATEWAY_SHA256 ||
    !Number.isFinite(start) ||
    start >= CREATED ||
    !Number.isFinite(activated) ||
    activated <= start ||
    activated >= CREATED ||
    !Number.isFinite(captured) ||
    captured <= REJECTED ||
    e.processRestarts !== 0 ||
    Date.parse(e.createdAt) !== CREATED ||
    Date.parse(e.rejectedAt) !== REJECTED ||
    e.intentAudits !== 1 ||
    e.rejectionAudits !== 1 ||
    e.orderCount !== 1 ||
    e.groupState !== "RECONCILIATION_REQUIRED" ||
    e.orderState !== "CANCEL_PENDING" ||
    e.side !== "BUY" ||
    e.timeInForce !== "GTD" ||
    e.submitted !== false ||
    e.brokerId !== false ||
    e.fills !== 0 ||
    e.positions !== 0 ||
    e.trades !== 0 ||
    e.brokerEvents !== 0 ||
    e.eventVariants !== 0 ||
    e.localProofs !== 0 ||
    e.otherUnresolvedEvents !== 0 ||
    !Number.isFinite(from) ||
    from > CREATED - 300_000 ||
    !Number.isFinite(until) ||
    until < REJECTED ||
    !Number.isFinite(observed) ||
    observed < until ||
    observed - until > 15_000 ||
    e.historyOrders !== 0 ||
    e.historyDeals !== 0 ||
    e.historyOrdersHasMore !== false ||
    e.historyDealsHasMore !== false ||
    e.openOrders !== 0 ||
    e.openPositions !== 0 ||
    e.brokerAccountBound !== true
  )
    throw new Error("PREDISPATCH_INCIDENT_EVIDENCE_INCOMPLETE");
}
