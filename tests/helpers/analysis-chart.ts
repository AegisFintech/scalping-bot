import { createHash } from "node:crypto";

import type { AnalysisChartArtifact } from "../../packages/contracts/src/index.js";

export function analysisChart(): AnalysisChartArtifact {
  const bytes = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(1600, 16);
  bytes.writeUInt32BE(1200, 20);
  bytes[24] = 8;
  bytes[25] = 2;
  return {
    rendererVersion: "completed-candles-ema-atr-v1",
    mimeType: "image/png",
    width: 1600,
    height: 1200,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    dataBase64: bytes.toString("base64"),
    completedCandlesOnly: true,
    candleCounts: { M1: 1, M5: 1, M15: 1 },
    latestEndTimes: {
      M1: "2026-01-01T00:00:00.000Z",
      M5: "2026-01-01T00:00:00.000Z",
      M15: "2026-01-01T00:00:00.000Z",
    },
  };
}
