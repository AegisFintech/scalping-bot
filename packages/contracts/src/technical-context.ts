import type { AnalyticsRequest, Quote } from "./index.js";

/** Separate non-authoritative HTTP contract; existing analytics schemas are immutable. */
export interface TechnicalContextRequest {
  readonly schemaVersion: "technical-context-request-1.0";
  readonly request: AnalyticsRequest;
  readonly quote: Quote;
  readonly tickSize: string;
  readonly minimumEntryDistance: string;
}
export interface TechnicalContextResponse {
  readonly schemaVersion: "technical-context-response-1.0";
  readonly requestId: string;
  readonly analysisId: string;
  readonly inputSha256: string;
  readonly capturedAt: string;
  readonly executionAuthority: false;
  readonly acceptable: boolean;
  readonly reasons: readonly string[];
  /** Detailed shape is checked against the versioned Python-generated JSON Schema. */
  readonly evidence: Readonly<Record<string, unknown>> | null;
  readonly codexPayload: Readonly<Record<string, unknown>> | null;
}

/** Broker source time and local receive/capture time are distinct clocks. */
export interface TechnicalContextRequestV11 extends Omit<
  TechnicalContextRequest,
  "schemaVersion"
> {
  readonly schemaVersion: "technical-context-request-1.1";
  readonly snapshotTime: string;
}
