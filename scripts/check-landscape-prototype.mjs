import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// Optional browser qualification; uses an existing Playwright installation.
// No new runtime dependency and no server/provider/broker access.
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH || "playwright",
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(
  process.argv[2] || "/tmp/scalper-landscape-preview",
);
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  const errors = [],
    requests = [];
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith("file:")) requests.push(r.url());
  });
  await page.clock.install();
  await page.goto(
    pathToFileURL(path.join(root, "docs/prototypes/landscape-desk.html")).href,
  );
  const results = {};
  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [1280, 720],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.clock.runFor(50);
    const bounds = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      main: document.querySelector("main").getBoundingClientRect().toJSON(),
      title: document
        .getElementById("action-title")
        .getBoundingClientRect()
        .toJSON(),
    }));
    assert.ok(
      bounds.width <= width,
      `${width}: horizontal overflow ${bounds.width}`,
    );
    if (width > 900) {
      assert.ok(
        bounds.height <= height,
        `${width}: vertical overflow ${bounds.height}`,
      );
      assert.ok(bounds.title.bottom < height - 25, `${width}: action clipped`);
      const visibleNext = await page.locator(".next").evaluate((el) => {
        const parent = el.closest(".reactor").getBoundingClientRect();
        return el.getBoundingClientRect().bottom <= parent.bottom;
      });
      assert.ok(visibleNext, `${width}: next action clipped`);
    }
    await page.screenshot({
      path: path.join(output, `landscape-${width}.png`),
      fullPage: true,
    });
    results[`${width}x${height}`] = true;
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("tab", { name: "M5", exact: true }).click();
  assert.equal(
    await page
      .getByRole("tab", { name: "M5", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await page.getByRole("tab", { name: "M5", exact: true }).press("ArrowRight");
  assert.equal(
    await page
      .getByRole("tab", { name: "M15", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await page.clock.runFor(6500);
  assert.equal(
    await page
      .getByRole("tab", { name: "M15", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  results.timeframeKeyboardAndRetention = true;
  for (const state of [
    "idle",
    "ai",
    "orders",
    "position",
    "blocked",
    "unavailable",
  ]) {
    await page.getByLabel("Preview scenario").selectOption(state);
    await page.clock.runFor(3001);
    const text = await page.locator("#action-title").innerText();
    assert.ok(text.length > 5);
    if (state === "ai")
      assert.match(
        await page.locator("#log").innerText(),
        /simulated durable request/,
      );
    if (state === "orders")
      assert.match(
        await page.locator("#position-state").innerText(),
        /PENDING/,
      );
    if (state === "blocked")
      assert.match(await page.locator("#open-net").innerText(), /Unavailable/);
    if (state === "unavailable") {
      for (const id of [
        "equity",
        "day-net",
        "open-net",
        "closed-net",
        "quote",
        "alignment",
        "triggers",
        "spread",
        "protection",
      ])
        assert.equal(
          await page.locator(`#${id}`).innerText(),
          "Unavailable",
          `${id} stale`,
        );
      assert.equal(await page.locator(".stage.active").count(), 0);
      assert.match(
        await page.locator("#price-chart").innerText(),
        /unavailable/i,
      );
    }
  }
  results.sixScenariosAndFailureWithholding = true;
  await page.getByLabel("Preview scenario").selectOption("position");
  await page.getByRole("button", { name: "Ⅱ Replay", exact: true }).click();
  const count = await page.locator(".event").count();
  await page.clock.runFor(7000);
  assert.equal(await page.locator(".event").count(), count);
  results.replayPause = true;
  await page.getByRole("button", { name: "▶ Replay", exact: true }).click();
  for (let i = 0; i < 70; i++) await page.clock.runFor(3000);
  assert.equal(await page.locator(".event").count(), 60);
  results.boundedLog = true;
  await page.locator("#log").dispatchEvent("wheel", { deltaY: -180 });
  await page.locator("#log").evaluate((el) => {
    el.scrollTop = 100;
  });
  assert.equal(
    await page.locator("#follow").getAttribute("aria-pressed"),
    "false",
  );
  await page.clock.runFor(6000);
  assert.equal(
    await page.locator("#follow").getAttribute("aria-pressed"),
    "false",
  );
  await page.locator("#follow").click();
  assert.equal(
    await page.locator("#follow").getAttribute("aria-pressed"),
    "true",
  );
  results.logFollowPause = true;
  const animationBefore = await page
    .locator(".orbit")
    .first()
    .evaluate((el) => getComputedStyle(el).transform);
  await page.clock.runFor(700);
  assert.notEqual(
    await page
      .locator(".orbit")
      .first()
      .evaluate((el) => getComputedStyle(el).transform),
    animationBefore,
  );
  results.animationProgress = true;
  await page.locator("#motion").click();
  assert.equal(
    await page.locator("#motion").getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(
    await page
      .locator(".orbit")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  results.motionPause = true;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.runFor(50);
  assert.equal(
    await page
      .locator(".orbit")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  results.reducedMotion = true;
  await page
    .getByRole("button", { name: "Operator controls ↗", exact: true })
    .click();
  assert.match(
    await page.locator("#notice").innerText(),
    /No trading controls/,
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#notice").isHidden(), true);
  results.disconnectedControls = true;
  await page.getByLabel("Enter fullscreen", { exact: true }).click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  assert.equal(
    await page.getByLabel("Exit fullscreen", { exact: true }).count(),
    1,
  );
  await page.getByLabel("Exit fullscreen", { exact: true }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  results.fullscreen = true;
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  results.pageErrors = 0;
  results.externalRequests = 0;
  fs.writeFileSync(
    path.join(output, "browser-results.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(JSON.stringify(results));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
