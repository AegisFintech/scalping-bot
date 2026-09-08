import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  readChart,
  writeChart,
} from "../../packages/database/src/chart-store.js";
import { analysisChart } from "../helpers/analysis-chart.js";

describe("durable content-addressed chart storage", () => {
  it("deduplicates exact bytes, verifies on read and refuses corrupt or redirected artifacts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "chart-"));
    try {
      const chart = analysisChart();
      const bytes = Buffer.from(chart.dataBase64, "base64");
      await Promise.all([
        writeChart(bytes, chart.sha256, dir),
        writeChart(bytes, chart.sha256, dir),
      ]);
      expect(await readdir(dir)).toEqual([`${chart.sha256}.png`]);
      expect(await readChart(chart.sha256, dir)).toEqual(bytes);
      await expect(readChart("../bad", dir)).rejects.toThrow(
        "CHART_DIGEST_INVALID",
      );
      await writeFile(path.join(dir, `${chart.sha256}.png`), "bad");
      await expect(writeChart(bytes, chart.sha256, dir)).rejects.toThrow(
        "CHART_INTEGRITY_INVALID",
      );
      await rm(path.join(dir, `${chart.sha256}.png`));
      await symlink("/dev/null", path.join(dir, `${chart.sha256}.png`));
      await expect(readChart(chart.sha256, dir)).rejects.toThrow();
      await expect(
        writeChart(Buffer.from("bad"), chart.sha256, dir),
      ).rejects.toThrow("CHART_INTEGRITY_INVALID");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
