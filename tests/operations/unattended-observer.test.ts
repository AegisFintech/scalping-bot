import { describe, expect, it } from "vitest";
import {
  observation,
  accumulate,
  type ObservationCounters,
} from "../../scripts/observe-unattended.js";

const release = "0.2.5-market-stop.8";
const status = {
  mode: "demo",
  strategyVersion: release,
  startupChecksPassed: true,
  operationalReady: true,
  tradingEnabled: true,
  automaticDemoTradeCampaign: { releaseClosedTrades: 2 },
  managedSetup: { status: "ACTIVE" },
  reasonCodes: [],
  privateField: "must-not-escape",
};
const checkpoint: ObservationCounters = {
  lastSampleAt: "2026-09-11T00:00:00Z",
  samples: 0,
  unavailableSamples: 0,
  notReadySamples: 0,
  samplingGaps: 0,
  maximumClosedTrades: null,
  latest: null,
  transitions: [],
};

describe("read-only unattended service observation", () => {
  it("exports only explicit operational fields", () => {
    expect(observation(status, release)).toEqual({
      available: true,
      startupReady: true,
      operationalReady: true,
      tradingEnabled: true,
      setup: "ACTIVE",
      releaseClosedTrades: 2,
      reasons: [],
    });
    expect(JSON.stringify(observation(status, release))).not.toContain(
      "must-not-escape",
    );
  });
  it.each([
    { ...status, mode: "live" },
    { ...status, strategyVersion: "old" },
    null,
  ])("rejects mismatched identity", (value) => {
    expect(observation(value, release)).toEqual({
      available: false,
      reasons: ["OBSERVATION_IDENTITY_MISMATCH"],
    });
  });
  it.each([
    { ...status, reasonCodes: ["private detail"] },
    { ...status, startupChecksPassed: null },
    { ...status, automaticDemoTradeCampaign: { releaseClosedTrades: -1 } },
  ])("rejects incomplete or unsafe status", (value) => {
    expect(observation(value, release)).toEqual({
      available: false,
      reasons: ["OBSERVATION_STATUS_INVALID"],
    });
  });
  it("retains faults and sample gaps across resumed observations", () => {
    const first = accumulate(
      checkpoint,
      observation(status, release),
      "2026-09-11T00:00:15Z",
    );
    const blocked = observation(
      {
        ...status,
        startupChecksPassed: false,
        reasonCodes: ["RECONCILIATION_UNCERTAIN"],
      },
      release,
    );
    const second = accumulate(first, blocked, "2026-09-11T00:02:00Z");
    const third = accumulate(
      second,
      observation(status, release),
      "2026-09-11T00:02:15Z",
    );
    expect(third).toMatchObject({
      samples: 3,
      notReadySamples: 1,
      unavailableSamples: 0,
      samplingGaps: 1,
    });
    expect(third.transitions).toHaveLength(3);
  });
  it("flags counters moving backwards and rejects a backwards clock", () => {
    const first = accumulate(
      checkpoint,
      observation(status, release),
      "2026-09-11T00:00:15Z",
    );
    expect(
      accumulate(
        first,
        observation(
          { ...status, automaticDemoTradeCampaign: { releaseClosedTrades: 1 } },
          release,
        ),
        "2026-09-11T00:00:30Z",
      ).latest,
    ).toEqual({ available: false, reasons: ["OBSERVATION_COUNTER_REGRESSED"] });
    expect(() =>
      accumulate(first, observation(status, release), "2026-09-10T00:00:00Z"),
    ).toThrow("OBSERVATION_CLOCK_INVALID");
  });
  it("bounds retained transitions without dropping aggregate failure counts", () => {
    let result = checkpoint;
    for (let i = 1; i <= 100; i++)
      result = accumulate(
        result,
        {
          available: false,
          reasons: [
            i % 2
              ? "OBSERVATION_STATUS_UNAVAILABLE"
              : "OBSERVATION_STATUS_INVALID",
          ],
        },
        new Date(Date.parse(checkpoint.lastSampleAt) + i * 15000).toISOString(),
      );
    expect(result.transitions).toHaveLength(64);
    expect(result).toMatchObject({
      samples: 100,
      unavailableSamples: 100,
      notReadySamples: 100,
    });
  });
});
