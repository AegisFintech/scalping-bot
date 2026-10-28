import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { TechnicalContextHttpClient } from "../../packages/analytics-client/src/technical-context.js";
import type {
  TechnicalContextRequest,
  TechnicalContextResponse,
  TechnicalContextResponseV11,
} from "../../packages/contracts/src/technical-context.js";
import { ModelResponseValidator } from "../../packages/risk-engine/src/model-validator.js";
const request = JSON.parse(
  readFileSync("tests/fixtures/technical-context/request.json", "utf8"),
) as TechnicalContextRequest;
const response = JSON.parse(
  readFileSync("tests/fixtures/technical-context/response.json", "utf8"),
) as TechnicalContextResponse;

describe("technical candidate HTTP boundary", () => {
  it("validates Python-generated response and identity without provider dispatch", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(response));
    const result = await new TechnicalContextHttpClient(
      "http://127.0.0.1:8091",
      fetchImpl,
    ).prepare(request);
    expect(result.executionAuthority).toBe(false);
    expect(result.codexPayload?.technical_context).toEqual(result.evidence);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls[0]?.[0] as URL).href).toBe(
      "http://127.0.0.1:8091/v1/technical-context",
    );
    expect(
      new ModelResponseValidator(
        "schemas/technical-context-response-1.0.json",
      ).parse(JSON.stringify(result)).accepted,
    ).toBe(true);
  });
  it.each([
    "https://127.0.0.1:8091",
    "http://example.test",
    "http://user:secret@localhost:8091",
  ])("rejects non-local/credential endpoint %s", (url) => {
    expect(() => new TechnicalContextHttpClient(url)).toThrow(
      "LOOPBACK_REQUIRED",
    );
  });
  it.each([
    "identity",
    "capture",
    "authority",
    "digest",
    "partial",
    "rejected_evidence",
  ])("rejects %s corruption", async (fault) => {
    const changed = structuredClone(response) as unknown as Record<
      string,
      unknown
    >;
    if (fault === "identity")
      changed.analysisId = "33333333-3333-4333-8333-333333333333";
    if (fault === "capture") changed.capturedAt = "2026-01-01T00:00:00Z";
    if (fault === "authority") changed.executionAuthority = true;
    if (fault === "digest") changed.inputSha256 = "f".repeat(64);
    if (fault === "partial") changed.codexPayload = null;
    if (fault === "rejected_evidence") {
      changed.acceptable = false;
      changed.reasons = ["UNAVAILABLE"];
    }
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(changed));
    await expect(
      new TechnicalContextHttpClient(
        "http://127.0.0.1:8091",
        fetchImpl,
      ).prepare(request),
    ).rejects.toThrow("TECHNICAL_CONTEXT_");
  });
  it("retains explicit rejection and refuses invalid input before network", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ...response,
        acceptable: false,
        reasons: ["DEPTH_STALE_AT_SNAPSHOT"],
        evidence: null,
        codexPayload: null,
      }),
    );
    const client = new TechnicalContextHttpClient(
      "http://127.0.0.1:8091",
      fetchImpl,
    );
    expect((await client.prepare(request)).acceptable).toBe(false);
    await expect(
      client.prepare({
        ...request,
        schemaVersion: "old",
      } as unknown as TechnicalContextRequest),
    ).rejects.toThrow("INPUT_INVALID");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("fails closed on timeout, HTTP failure, oversized and invalid response", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new TechnicalContextHttpClient(
      "http://127.0.0.1:8091",
      fetchImpl,
    );
    fetchImpl.mockRejectedValueOnce(new Error("timeout"));
    await expect(client.prepare(request)).rejects.toThrow();
    fetchImpl.mockResolvedValueOnce(
      new Response("unavailable", { status: 503 }),
    );
    await expect(client.prepare(request)).rejects.toThrow("HTTP_UNAVAILABLE");
    fetchImpl.mockResolvedValueOnce(new Response(" ".repeat(128_001)));
    await expect(client.prepare(request)).rejects.toThrow();
    fetchImpl.mockResolvedValueOnce(new Response("{}"));
    await expect(client.prepare(request)).rejects.toThrow("RESPONSE_INVALID");
  });
});

it("routes explicit local snapshot time separately without changing legacy requests", async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json(response));
  const client = new TechnicalContextHttpClient(
    "http://127.0.0.1:8091",
    fetchImpl,
  );
  const current = {
    ...request,
    schemaVersion: "technical-context-request-1.1" as const,
    snapshotTime: request.request.serverTime,
  };
  expect((await client.prepare(current)).executionAuthority).toBe(false);
  expect((fetchImpl.mock.calls[0]?.[0] as URL).pathname).toBe(
    "/v2/technical-context",
  );
});

it("routes the level map to v3 and requires its own response and candidate", async () => {
  const levels = JSON.parse(
    readFileSync("tests/fixtures/technical-context/response-1.1.json", "utf8"),
  ) as TechnicalContextResponseV11;
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json(levels));
  const client = new TechnicalContextHttpClient(
    "http://127.0.0.1:8091",
    fetchImpl,
  );
  const current = {
    ...request,
    schemaVersion: "technical-context-request-1.2" as const,
    snapshotTime: request.request.serverTime,
  };
  const result = await client.prepare(current);
  expect(result.schemaVersion).toBe("technical-context-response-1.1");
  expect(result.evidence?.definitions_version).toBe("causal-smc-1.1");
  expect((fetchImpl.mock.calls[0]?.[0] as URL).pathname).toBe(
    "/v3/technical-context",
  );
  expect(
    new ModelResponseValidator(
      "schemas/technical-context-response-1.1.json",
    ).parse(JSON.stringify(result)).accepted,
  ).toBe(true);
  // A legacy, unversioned response or legacy candidate never satisfies a level map.
  fetchImpl.mockResolvedValueOnce(Response.json(response));
  await expect(client.prepare(current)).rejects.toThrow("RESPONSE_INVALID");
  const unversioned = structuredClone(levels) as unknown as Record<
    string,
    unknown
  >;
  delete unversioned.schemaVersion;
  fetchImpl.mockResolvedValueOnce(Response.json(unversioned));
  await expect(client.prepare(current)).rejects.toThrow("RESPONSE_INVALID");
  const legacy = structuredClone(levels) as unknown as {
    codexPayload: Record<string, unknown>;
  };
  legacy.codexPayload.version = "entry-context-candidate-1.0";
  fetchImpl.mockResolvedValueOnce(Response.json(legacy));
  await expect(client.prepare(current)).rejects.toThrow("PROVENANCE_MISMATCH");
});
