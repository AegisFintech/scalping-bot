import { describe, expect, it } from "vitest";
import {
  parseObservationArguments,
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

describe("unattended observer release selection", () => {
  const args = (release: string, hours = "24") => [
    "--release",
    release,
    "--hours",
    hours,
    "--output",
    "/tmp/observer.json",
  ];
  it.each(["0.3.0-fade-limit.3", "0.2.5-market-stop.8"])(
    "accepts the current or historical observation release %s",
    (release) => {
      expect(parseObservationArguments(args(release))).toEqual({
        release,
        hours: 24,
        output: "/tmp/observer.json",
      });
      expect(
        observation({ ...status, strategyVersion: release }, release).available,
      ).toBe(true);
      expect(
        observation({ ...status, strategyVersion: "different" }, release),
      ).toEqual({
        available: false,
        reasons: ["OBSERVATION_IDENTITY_MISMATCH"],
      });
    },
  );
  it.each(["0.3.0-fade-limit.999", "live", "", "0.3.0-fade-limit.3\n"])(
    "rejects unsupported or malformed release %s",
    (release) => {
      expect(() => parseObservationArguments(args(release))).toThrow(
        "OBSERVATION_ARGUMENTS_INVALID",
      );
    },
  );
  it.each(["0", "169", "NaN", "Infinity"])(
    "rejects unbounded duration %s",
    (hours) => {
      expect(() =>
        parseObservationArguments(args("0.3.0-fade-limit.3", hours)),
      ).toThrow("OBSERVATION_ARGUMENTS_INVALID");
    },
  );
  it("rejects missing or reordered arguments", () => {
    expect(() => parseObservationArguments([])).toThrow(
      "OBSERVATION_ARGUMENTS_INVALID",
    );
    expect(() =>
      parseObservationArguments([
        "--hours",
        "24",
        "--release",
        "0.3.0-fade-limit.3",
        "--output",
        "/tmp/observer.json",
      ]),
    ).toThrow("OBSERVATION_ARGUMENTS_INVALID");
  });
});
