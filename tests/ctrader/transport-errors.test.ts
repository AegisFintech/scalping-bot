import { describe, expect, it } from "vitest";

import {
  CTraderRequestRejectedError,
  cTraderErrorDetails,
} from "../../packages/ctrader-client/src/transport.js";

describe("cTrader rejection diagnostics", () => {
  it("preserves the broker code and bounded description without raw payload data", () => {
    const error = new CTraderRequestRejectedError(2142, {
      errorCode: "CH_ACCESS_DENIED",
      description: "Cash-flow history is not available for this account",
      accessToken: "must-not-be-recorded",
      nested: { secret: "must-not-be-recorded" },
    });

    expect(error.message).toBe("CTRADER_REQUEST_REJECTED");
    expect(cTraderErrorDetails(error)).toEqual({
      payloadType: 2142,
      code: "CH_ACCESS_DENIED",
      description: "Cash-flow history is not available for this account",
    });
    expect(JSON.stringify(cTraderErrorDetails(error))).not.toContain(
      "must-not-be-recorded",
    );
  });

  it("does not expose arbitrary objects as broker diagnostics", () => {
    const error = new CTraderRequestRejectedError(2142, {
      errorCode: { secret: "hidden" },
      description: null,
    });

    expect(cTraderErrorDetails(error)).toEqual({
      payloadType: 2142,
      code: null,
      description: null,
    });
  });
});
