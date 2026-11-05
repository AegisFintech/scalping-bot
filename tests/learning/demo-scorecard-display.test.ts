import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

it("withholds stale day/proof observations independently and clears them when offline", async () => {
  const html = readFileSync("apps/dashboard/assets/learning.html", "utf8");
  const elements = new Map(
    [...html.matchAll(/id="([^"]+)"/g)].map((m) => [
      m[1],
      { textContent: "", hidden: false, addEventListener: () => {} },
    ]),
  );
  let now = Date.parse("2026-11-04T05:00:00Z");
  let scheduled: () => Promise<void> | void = () => undefined;
  let expire: () => Promise<void> | void = () => undefined;
  let offline = false;
  let hanging = false;
  const data = {
    dailyTradingNet: {
      schemaVersion: "daily-trading-net-1.0",
      checkedAt: new Date(now).toISOString(),
      currency: "USD",
      timezone: "Asia/Singapore",
      totals: {
        day: "2026-11-04",
        since: "2026-11-03T16:00:00Z",
        until: "2026-11-04T05:00:00Z",
        recordedNet: "-1846.13",
        signedFeesIncluded: "-1558.78",
        closeDeals: 16,
      },
      releases: [
        { release: "old-release", recordedNet: "-1846.13", closeDeals: 16 },
      ],
      openJournalPositions: 0,
      scopeUnresolvedEvents: 0,
    },
    dayScorecard: {
      checkedAt: new Date(now).toISOString(),
      currency: "USD",
      release: "0.10.0-demo-trials.1-codex.1",
      recordedNet: "93.00",
      realizedLedgerDrawdownLowerBound: "0",
      scopeUnresolvedEvents: 0,
      openJournalPositions: 1,
      trialOutcomes: [
        {
          profileId: "ENTRY_RANGE_3",
          state: "ACTIVE",
          sourceSha256: "a".repeat(64),
          profileSha256: "b".repeat(64),
          proposals: 10,
          providerClaims: 0,
          waits: 3,
          failedProposals: 1,
          incompleteContexts: 1,
          groups: 5,
          provenZeroFillGroups: 1,
          provenUnsentGroups: 1,
          provenClosedGroups: 2,
          unprovenGroups: 1,
        },
      ],
      days: [
        {
          day: "2026-11-04",
          completeCalendarDay: false,
          recordedNet: "93.00",
          closeDeals: 1,
          winningCloseDeals: 1,
          losingCloseDeals: 0,
          flatCloseDeals: 0,
          signedFeesIncluded: "-7.00",
          worstCloseDeal: "93.00",
        },
      ],
    },
    naturalTrialEvidence: {
      checkedAt: new Date(now).toISOString(),
      sourceSha256: "a".repeat(64),
      retainedCompletedAllocations: 2,
      windowFilledCompletedAllocations: 2,
      windowDistinctFilledProfilesWithNextAction: 2,
      actualRestartRecorded: false,
      actualRestartProofBound: false,
      engineeringMilestoneObserved: false,
    },
  };
  runInNewContext(readFileSync("apps/dashboard/assets/learning.mjs", "utf8"), {
    document: { getElementById: (id: string) => elements.get(id) ?? null },
    Date: class extends Date {
      static override now() {
        return now;
      }
    },
    window: {
      setInterval: (fn: () => Promise<void> | void, interval: number) => {
        if (interval === 1000) expire = fn;
        else scheduled = fn;
      },
    },
    fetch: () =>
      hanging
        ? new Promise(() => {})
        : offline
          ? Promise.reject(new Error("fixture offline"))
          : Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ readState: "ready", data }),
            }),
  });
  const text = (id: string) => elements.get(id)?.textContent ?? "missing";
  await vi.waitFor(() => expect(text("days-results")).toContain("net 93.00"));
  expect(text("daily-net-value")).toContain("USD -1,846.13");
  expect(text("daily-net-releases")).toContain("old-release");
  expect(text("daily-net-details")).toContain(
    "Configured demo account · XAUUSD",
  );
  expect(text("daily-net-time")).toContain(
    "2026-11-03T16:00:00Z to 2026-11-04T05:00:00Z",
  );
  expect(text("days-results")).toContain("partial day");
  expect(text("days-results")).toContain("already included -7.00");
  expect(text("days-trial-outcomes")).toContain(
    "1 proven zero-fill / 1 proven unsent / 2 proven closed / 1 open or unproven",
  );
  expect(text("trial-evidence")).toContain("proof pending");
  expect(text("trial-evidence")).toContain("restart recorded: no");
  now += 31000;
  await scheduled();
  expect(text("daily-net-value")).toContain("unavailable");
  expect(text("daily-net-releases")).toBe("");
  expect(text("days-results")).toBe("");
  expect(text("days-trial-outcomes")).toBe("");
  expect(text("trial-evidence")).toContain("proof pending");
  now += 150000;
  await scheduled();
  expect(text("trial-evidence")).toContain("unavailable or stale");
  now = Date.parse(data.dayScorecard.checkedAt);
  await scheduled();
  expect(text("days-results")).toContain("net 93.00");
  Object.assign(data.dayScorecard, { trialOutcomesReadState: "unavailable" });
  Object.assign(data.naturalTrialEvidence, {
    available: false,
    reason: "WITNESS_STORAGE_RESERVE",
  });
  await scheduled();
  expect(text("days-results")).toContain("net 93.00");
  expect(text("days-trial-outcomes")).toContain("counts are not zero");
  expect(text("trial-evidence")).toContain("WITNESS_STORAGE_RESERVE");
  now = Date.parse("2026-11-04T15:59:59Z");
  data.dailyTradingNet.checkedAt = new Date(now).toISOString();
  await scheduled();
  expect(text("daily-net-value")).toContain("USD -1,846.13");
  now += 2000;
  await scheduled();
  expect(text("daily-net-value")).toContain("unavailable");
  expect(text("daily-net-releases")).toBe("");
  offline = true;
  await scheduled();
  expect(text("days-results")).toBe("");
  expect(text("trial-evidence")).toContain("unavailable or stale");
  offline = false;
  now = Date.parse("2026-11-04T05:00:00Z");
  data.dailyTradingNet.checkedAt = new Date(now).toISOString();
  await scheduled();
  expect(text("daily-net-value")).toContain("USD -1,846.13");
  hanging = true;
  void scheduled();
  now += 31000;
  void expire();
  expect(text("daily-net-value")).toContain("unavailable");
  expect(text("daily-net-releases")).toBe("");
});
