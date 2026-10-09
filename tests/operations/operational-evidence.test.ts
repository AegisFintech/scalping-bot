import { expect, it } from "vitest";
import {
  MAX_JOURNAL_BYTES,
  chainRecord,
  evidenceSample,
  registration,
  summarizeOperational,
  verifyJournal,
  type EvidenceRecord,
} from "../../packages/evaluation/src/operational-evidence.js";
const release = "0.3.0-fade-limit.3",
  start = "2026-10-09T02:00:00.000Z";
const at = (seconds: number) =>
  new Date(Date.parse(start) + seconds * 1000).toISOString();
const status = (seconds: number, count = 197) => ({
  mode: "demo",
  strategyVersion: release,
  startupChecksPassed: true,
  operationalReady: true,
  tradingEnabled: false,
  automaticDemoTradeCampaign: { releaseClosedTrades: count },
  managedSetup: { status: "LATEST_TERMINAL" },
  reasonCodes: ["ACTIVE_GROUP_EXISTS"],
  marketSession: {
    state: "OPEN",
    checkedAt: at(seconds),
    scheduleFetchedAt: at(seconds),
    reasonCode: null,
  },
});
const content = (records: EvidenceRecord[]) =>
  records.map((r) => JSON.stringify(r)).join("\n") + "\n";
const records = (times: number[]) => {
  const r = [chainRecord(registration(release, 1, start), null)];
  for (const t of times)
    r.push(chainRecord(evidenceSample(status(t), release, at(t)), r.at(-1)!));
  return r;
};
it("retains all samples with linked integrity and counts only adjacent fresh open intervals", () => {
  const r = records([0, 15, 30]);
  expect(verifyJournal(content(r))).toEqual(r);
  expect(summarizeOperational(r, at(40))).toMatchObject({
    samples: 3,
    sampledOpenMs: 30000,
    sampledReadyOpenMs: 30000,
    qualification: "UNQUALIFIED",
    brokerCalendarVerifiedHours: null,
    protectedCycles: null,
    alertReceipt: null,
    currentRestore: null,
    brokerAuthority: false,
    promotionAuthority: false,
  });
});
it("excludes gaps, first/tail time and unavailable endpoints instead of manufacturing uptime", () => {
  const r = records([15, 30, 90]);
  r.push(chainRecord(evidenceSample(null, release, at(105)), r.at(-1)!));
  expect(summarizeOperational(r, at(200))).toMatchObject({
    sampledOpenMs: 15000,
    gapIntervals: 1,
    unavailableSamples: 1,
    notReadySamples: 1,
  });
});
it("censors stale, future, contradictory, malformed and other-mode session evidence", () => {
  const good = status(0);
  for (const input of [
    { ...good, mode: "live" },
    { ...good, strategyVersion: "unsupported" },
    { ...good, marketSession: { ...good.marketSession, checkedAt: at(1) } },
    {
      ...good,
      marketSession: { ...good.marketSession, scheduleFetchedAt: at(1) },
    },
    {
      ...good,
      marketSession: {
        ...good.marketSession,
        reasonCode: "MARKET_SESSION_CLOSED",
      },
    },
    { ...good, marketSession: null },
  ])
    expect(evidenceSample(input, release, start).session).toBe("UNAVAILABLE");
  expect(evidenceSample(good, release, at(30)).session).toBe("UNAVAILABLE");
});
it("rejects corruption, omission, reordering and incomplete crash tails without rewriting history", () => {
  const r = records([0, 15, 30]);
  for (const value of [
    content(r).slice(0, -1),
    content([r[0]!, r[2]!, r[3]!]),
    content([r[0]!, r[2]!, r[1]!]),
    content(r).replace('"closedTrades":197', '"closedTrades":198'),
  ])
    expect(() => verifyJournal(value)).toThrow();
});
it("rejects clock reversal, repeated registration, counter regression and out-of-window samples", () => {
  for (const sample of [
    evidenceSample(status(0), release, at(-1)),
    evidenceSample(status(0, 196), release, at(15)),
    evidenceSample(status(3600), release, at(3600)),
    registration(release, 1, start),
  ]) {
    const r = records([0]);
    r.push(chainRecord(sample, r.at(-1)!));
    expect(() => verifyJournal(content(r))).toThrow();
  }
});
it("validates duration, fixed release, as-of and registration independently of a checksum", () => {
  for (const hours of [0, 169, 1.5, NaN])
    expect(() => registration(release, hours, start)).toThrow(
      "OPERATIONAL_ARGUMENTS_INVALID",
    );
  expect(() => registration("0.3.0-fade-limit.9", 1, start)).toThrow();
  expect(() => summarizeOperational(records([15]), at(0))).toThrow(
    "OPERATIONAL_AS_OF_INVALID",
  );
  const header = { ...registration(release, 1, start), deadline: at(5) };
  expect(() => verifyJournal(content([chainRecord(header, null)]))).toThrow(
    "OPERATIONAL_REGISTRATION_INVALID",
  );
});
it("records readiness separately from trading eligibility and closed sessions", () => {
  const r = records([0]);
  r.push(
    chainRecord(
      evidenceSample(
        { ...status(15), operationalReady: false },
        release,
        at(15),
      ),
      r.at(-1)!,
    ),
  );
  r.push(
    chainRecord(
      evidenceSample(
        {
          ...status(30),
          marketSession: {
            ...status(30).marketSession,
            state: "CLOSED",
            reasonCode: "MARKET_SESSION_CLOSED",
          },
        },
        release,
        at(30),
      ),
      r.at(-1)!,
    ),
  );
  expect(summarizeOperational(r, at(35))).toMatchObject({
    sampledOpenMs: 15000,
    sampledReadyOpenMs: 0,
    notReadySamples: 1,
  });
});

it("rejects oversized input before parsing untrusted journal text", () => {
  expect(() => verifyJournal("x".repeat(MAX_JOURNAL_BYTES) + "\n")).toThrow(
    "OPERATIONAL_JOURNAL_TOO_LARGE",
  );
});
