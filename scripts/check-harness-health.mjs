// Optional installed-browser check; only fixture data, no broker/provider requests.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH || "playwright",
);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const now = new Date("2026-10-30T12:00:00Z");
  await page.clock.install({ time: now });
  await page.route("http://fixture/**", (route) => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (["landscape.mjs", "landscape.css"].includes(name)) {
      return route.fulfill({
        body: fs.readFileSync(`apps/dashboard/assets/${name}`),
        contentType: name.endsWith("mjs") ? "text/javascript" : "text/css",
      });
    }
    return route.fulfill({
      contentType: "text/html",
      body:
        '<link rel="stylesheet" href="/landscape.css">' +
        fs.readFileSync("apps/dashboard/assets/landscape.html", "utf8") +
        '<script type="module">import render from "/landscape.mjs";window.render = render;</script>',
    });
  });
  await page.goto("http://fixture/");
  await page.waitForFunction(() => Boolean(window.render));
  await page.evaluate((at) => {
    const stages = [
      "Demo",
      "Flight recorder",
      "Observation",
      "Experiments",
      "Publishing",
    ].map((name) => ({
      name,
      state: "CURRENT",
      checkedAt: at,
      expiresAt: "2026-10-30T12:00:01Z",
      detail: "Observed fixture",
    }));
    window.model = {
      harness: {
        checkedAt: at,
        stages,
        research: {
          question: '<img src=x onerror="alert(1)">',
          planId: "a".repeat(64),
          trialId: "b".repeat(64),
          closureCounts: { NEGATIVE: 2 },
        },
        publisher: { pullRequest: 123, status: "AWAITING_REVIEW" },
      },
    };
    window.cleanup = window.render({
      data: window.model,
      parentElement: document.body,
    });
  }, now.toISOString());
  const summary = page.locator(".harness-details summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator(".harness-details").getAttribute("open"), "");
  assert.equal(await page.locator("#harness-stages > div").count(), 5);
  assert.match(
    await page.locator("#harness-trials").textContent(),
    /NEGATIVE 2/,
  );
  assert.equal(await page.locator("#harness-question img").count(), 0);
  assert.equal(
    await page.locator("#harness-pr").getAttribute("href"),
    "https://github.com/AegisFintech/scalping-bot/pull/123",
  );
  for (const width of [1920, 1440, 1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await page.locator(".harness-card").boundingBox();
    assert.ok(
      bounds && bounds.x >= 0 && bounds.x + bounds.width <= width,
      `Panel overflow at ${width}`,
    );
  }
  await page.clock.runFor(2100);
  assert.match(
    await page.locator("#harness-stages").textContent(),
    /Observation · STALE/,
  );
  assert.equal(await page.locator("#harness-pr").isVisible(), false);
  assert.match(
    await page.locator("#harness-trials").textContent(),
    /unavailable/,
  );
  assert.match(
    await page.locator("#harness-question").textContent(),
    /No current/,
  );
  await page.clock.runFor(180000);
  assert.equal(
    await page.locator("#research-health").textContent(),
    "Unavailable",
  );
  assert.equal(await page.locator("#harness-stages > div").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Harness browser checks passed: keyboard, bounds, text safety, stage and collector expiry.",
  );
} finally {
  await browser.close();
}
