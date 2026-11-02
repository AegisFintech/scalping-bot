import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

it("renders recorded measurement separately and clears unavailable or unclassified values", async () => {
  const html = readFileSync("apps/dashboard/assets/learning.html", "utf8");
  const elements = new Map(
    [...html.matchAll(/id="([^"]+)"/g)].map((match) => [
      match[1],
      { textContent: "", hidden: false, addEventListener: () => {} },
    ]),
  );
  const text = (id: string) =>
    elements.get(id)?.textContent ?? "MISSING_ELEMENT";
  let scheduled: () => Promise<void> = () => Promise.resolve();
  let missing = false;
  let offline = false;
  const measurement = {
    start: "2026-11-02T05:30:00+00:00",
    until: "2026-11-02T06:00:00+00:00",
    journalSnapshotAt: "2026-11-02T06:02:00+00:00",
    contexts: 25,
    decisionCounts: { WAIT: 25 },
    orderRecords: 0,
    brokerAcceptedOrderRecords: 0,
    filledOrderRecords: 0,
    partialOrderRecords: 0,
    windowClosedRows: 0,
    researchBaselineDecisions: { BUY: 16, WAIT: 9 },
    availabilityToAcceptance: { known: 0, unknown: 0, p50Micros: null },
    requestToAvailability: { known: 23, unknown: 2 },
  };
  const data: Record<string, unknown> = {
    pipeline: {
      available: true,
      generation: {
        status: "WAITING_RESEARCH_DUPLICATE",
        reason: "WAITING_RESEARCH_DUPLICATE",
      },
    },
    executionFunnelReadState: "CURRENT",
    executionFunnel: measurement,
  };
  runInNewContext(readFileSync("apps/dashboard/assets/learning.mjs", "utf8"), {
    document: { getElementById: (id: string) => elements.get(id) ?? null },
    window: {
      setInterval: (fn: () => Promise<void>) => {
        scheduled = fn;
      },
    },
    fetch: () => {
      if (offline) return Promise.reject(new Error("fixture offline"));
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            missing ? { readState: "stale" } : { readState: "ready", data },
          ),
      });
    },
  });
  await vi.waitFor(() => expect(text("funnel-decisions")).toContain("WAIT 25"));
  expect(text("funnel-window")).toContain("RECORDED CURRENT");
  expect(text("funnel-window")).toContain(measurement.until);
  expect(text("pipeline-generation")).toContain(
    "Code generation: WAITING_RESEARCH_DUPLICATE",
  );
  expect(text("funnel-orders")).toContain("Order rows 0");
  expect(text("funnel-baseline")).toContain("BUY 16");
  expect(text("funnel-baseline")).toContain("Unexecuted hypotheses");
  expect(text("funnel-latency")).toContain("23 known / 2 unknown");
  data.executionFunnelReadState = "STALE";
  await scheduled();
  expect(text("funnel-window")).toContain("RECORDED STALE");
  expect(text("funnel-decisions")).toContain("WAIT 25");
  for (const state of ["UNAVAILABLE", undefined]) {
    data.executionFunnelReadState = state;
    await scheduled();
    expect(text("funnel-window")).toContain("unavailable");
    for (const id of [
      "funnel-decisions",
      "funnel-orders",
      "funnel-baseline",
      "funnel-latency",
    ])
      expect(text(id)).toBe("");
  }
  data.executionFunnelReadState = "CURRENT";
  await scheduled();
  expect(text("funnel-window")).toContain("RECORDED CURRENT");
  missing = true;
  await scheduled();
  expect(text("state")).toContain("Evidence stale");
  expect(elements.get("board")?.hidden).toBe(true);
  expect(text("funnel-decisions")).toBe("");
  expect(text("funnel-window")).toContain("unavailable");
  missing = false;
  await scheduled();
  expect(elements.get("board")?.hidden).toBe(false);
  expect(text("funnel-window")).toContain("RECORDED CURRENT");
  offline = true;
  await scheduled();
  expect(elements.get("board")?.hidden).toBe(true);
  expect(text("state")).toContain("fixture offline");
  expect(text("funnel-window")).toContain("unavailable");
  expect(text("funnel-decisions")).toBe("");
});
