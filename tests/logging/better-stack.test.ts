import { describe, expect, it, vi } from "vitest";

import { BetterStackTransport } from "../../packages/logging/src/index.js";

describe("Better Stack transport", () => {
  it("redacts recursively before sending", async () => {
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) => {
        if (typeof init?.body !== "string") throw new Error("missing body");
        expect(init.body).not.toContain("super-secret-value");
        expect(init.body).toContain("[REDACTED]");
        return Promise.resolve(new Response("", { status: 202 }));
      },
    );
    const transport = new BetterStackTransport({
      enabled: true,
      ingestingHost: "https://in.logs.example.invalid/",
      sourceToken: "transport-token",
      fetchImpl: fetchMock,
    });
    await expect(
      transport.send({
        event_name: "test",
        nested: { access_token: "super-secret-value" },
      }),
    ).resolves.toBe(true);
  });

  it("does not throw when remote logging fails", async () => {
    const transport = new BetterStackTransport({
      enabled: true,
      ingestingHost: "https://in.logs.example.invalid/",
      sourceToken: "transport-token",
      fetchImpl: vi.fn(() => Promise.reject(new Error("network"))),
    });
    await expect(transport.send({ event_name: "test" })).resolves.toBe(false);
  });
});
