import { describe, expect, it } from "vitest";

import { pseudonym, redact } from "../../packages/logging/src/index.js";

describe("log redaction", () => {
  it("recursively removes secrets and authorization values", () => {
    const safe = redact({
      api_key: "secret-value",
      nested: {
        authorization: "Bearer abc.def",
        message: "failed with Bearer raw-token",
      },
      database: "postgresql://user:pass@host/db?token=abc",
    });
    expect(JSON.stringify(safe)).not.toContain("secret-value");
    expect(JSON.stringify(safe)).not.toContain("raw-token");
    expect(JSON.stringify(safe)).not.toContain("user:pass");
  });

  it("creates stable bounded account pseudonyms", () => {
    expect(pseudonym("account-1", "salt")).toBe(pseudonym("account-1", "salt"));
    expect(pseudonym("account-1", "salt")).toHaveLength(24);
  });
});
