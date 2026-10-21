// Optional installed-Playwright checks. No trading control is submitted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH || "playwright",
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = new URL(process.argv[2] || "http://127.0.0.1:8600");
if (
  url.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  url.username ||
  url.password
)
  throw new Error("LOOPBACK_PREVIEW_REQUIRED");
const output = path.resolve(process.argv[3] || "/tmp/scalper-landscape-live");
if (output.startsWith(root + path.sep))
  throw new Error("PRIVATE_SCREENSHOTS_OUTSIDE_REPOSITORY_REQUIRED");
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
fs.chmodSync(output, 0o700);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
    : {}),
  args: ["--no-sandbox"],
});
try {
  const results = {};
  const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url.href);
  await page.locator("#desk").waitFor();
  await page.waitForFunction(() => {
    const walk = (n) =>
      n.querySelector("#desk") ||
      [...n.querySelectorAll("*")]
        .map((e) => e.shadowRoot && walk(e.shadowRoot))
        .find(Boolean);
    const desk = walk(document);
    return desk?.querySelector("#mode")?.textContent !== "UNKNOWN";
  });
  assert.equal(await page.getByTestId("stException").count(), 0);
  const deskHandle = await page.locator("#desk").elementHandle();
  await page.getByRole("tab", { name: "M5", exact: true }).click();
  await page.locator("#motion").click();
  await page.locator("#log").dispatchEvent("wheel", { deltaY: -100 });
  const firstRows = await page.locator("#log .event").count();
  assert.ok(firstRows <= 160);
  await page.waitForTimeout(6500);
  assert.equal(
    await page.locator("#desk").evaluate((el, old) => el === old, deskHandle),
    true,
  );
  assert.equal(
    await page
      .getByRole("tab", { name: "M5", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  assert.equal(
    await page.locator("#motion").getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(
    await page.locator("#follow").getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(await page.locator("#flow .stage").count(), 6);
  results.deskStateRetainedAcrossTicks = true;
  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [1280, 720],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(200);
    const bounds = await page.locator("#desk").evaluate((el) => ({
      width: el.scrollWidth,
      box: el.getBoundingClientRect().toJSON(),
      next: el.querySelector(".next").getBoundingClientRect().toJSON(),
      reactor: el.querySelector(".reactor").getBoundingClientRect().toJSON(),
      bodyWidth: document.documentElement.scrollWidth,
      headerBottom:
        document
          .querySelector("header[data-testid=stHeader]")
          ?.getBoundingClientRect().bottom || 0,
      titleTop: el.querySelector(".brand").getBoundingClientRect().top,
    }));
    assert.ok(bounds.bodyWidth <= width, `${width}: horizontal overflow`);
    assert.ok(
      bounds.titleTop >= bounds.headerBottom,
      `${width}: native header overlaps brand`,
    );
    assert.ok(bounds.width <= bounds.box.width + 2, `${width}: desk overflow`);
    if (width > 900) {
      assert.ok(bounds.box.bottom <= height + 2, `${width}: not one page`);
      assert.ok(
        bounds.next.bottom <= bounds.reactor.bottom + 1,
        `${width}: next action clipped`,
      );
    }
    const file = path.join(output, `landscape-${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    fs.chmodSync(file, 0o600);
    results[`${width}x${height}`] = true;
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await page.getByRole("radio").count(), 0);
  assert.equal(await page.getByRole("textbox").count(), 0);
  assert.equal(await page.getByTestId("stSidebar").count(), 0);
  assert.equal(await page.getByTestId("stHeader").count(), 0);
  const edge = await page.locator("#desk").boundingBox();
  assert.ok(
    Math.abs(edge.x) <= 1 && Math.abs(edge.y) <= 1,
    "desk not edge to edge",
  );
  assert.equal(await page.getByTestId("stException").count(), 0);
  results.readOnlyWithoutNavigationOrSidebar = true;
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(2300);
  assert.equal(
    await page
      .locator("#desk")
      .evaluate(
        (el) => getComputedStyle(el.ownerDocument.body).backgroundColor,
      ),
    "rgb(9, 11, 18)",
  );
  results.lightSchemeCompatible = true;
  await page.route("**/api/desk", (route) => route.abort());
  await page.waitForFunction(
    () =>
      document.getElementById("status-health")?.textContent === "Unavailable",
  );
  assert.equal(await page.locator("#equity").textContent(), "Unavailable");
  assert.equal(
    await page.locator("#action-title").textContent(),
    "Data unavailable",
  );
  results.transportFailureWithdrawsEvidence = true;
  await page.unroute("**/api/desk");
  await page.waitForFunction(
    () => document.getElementById("status-health")?.textContent === "Observed",
  );
  results.transportAutomaticallyRecovers = true;
  assert.deepEqual(errors, []);
  results.pageErrors = 0;
  await page.close();
  // Isolated frontend harness: only synthetic, clearly test-scoped data. No server.
  const harness = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    }),
    harnessErrors = [],
    requests = [];
  harness.on("pageerror", (e) => harnessErrors.push(e.message));
  harness.on("request", (r) => requests.push(r.url()));
  const time = Date.now();
  await harness.clock.install({ time });
  await harness.setContent('<div id="mount"></div>');
  const assets = path.join(root, "apps/dashboard/assets");
  await harness.evaluate(
    ({ html, css, js }) => {
      const shadow = document
        .getElementById("mount")
        .attachShadow({ mode: "open" });
      shadow.innerHTML = html;
      const style = document.createElement("style");
      style.textContent = css;
      shadow.append(style);
      const script = document.createElement("script");
      script.type = "module";
      script.textContent =
        js.replace("export default function", "function render") +
        '\nlet cleanup;window.applyDesk=(data)=>{cleanup?.();cleanup=render({data,parentElement:document.getElementById("mount").shadowRoot});};';
      document.head.append(script);
    },
    {
      html: fs.readFileSync(path.join(assets, "landscape.html"), "utf8"),
      css: fs.readFileSync(path.join(assets, "landscape.css"), "utf8"),
      js: fs.readFileSync(path.join(assets, "landscape.mjs"), "utf8"),
    },
  );
  await harness.waitForFunction(() => typeof window.applyDesk === "function");
  const iso = (delta) => new Date(time + delta).toISOString();
  const values = Object.fromEntries(
    [
      "equity",
      "day-net",
      "ceiling",
      "open-net",
      "position-pnl",
      "quote",
      "ask",
      "closed-net",
    ].map((id) => [
      id,
      {
        text: id === "open-net" ? "-2.30" : "100.00",
        tone: "neutral",
        until: iso(id === "open-net" || id === "position-pnl" ? 10000 : 30000),
      },
    ]),
  );
  const fixture = {
    available: true,
    mode: "DEMO",
    symbol: "XAUUSD",
    currency: "USD",
    capturedAt: iso(0),
    expiresAt: iso(30000),
    session: "OPEN",
    sessionUntil: iso(10000),
    title: '<img src=x onerror="window.unsafe=true">',
    detail: "Synthetic harness status",
    next: "Wait",
    stage: "position",
    values,
    positions: [
      {
        side: "BUY",
        state: "OPEN",
        volume: "1",
        entry: "4000",
        sl: "3999",
        tp: "4001",
        protection: "Verified broker",
        until: iso(10000),
      },
    ],
    orders: [],
    exposureKnown: true,
    charts: {},
    factors: [
      ["Safe text", '<svg onload="window.unsafe=true">'],
      ["Current spread", "0.20"],
    ],
    factorUntil: { "Current spread": iso(10000) },
    events: [
      {
        id: "a",
        at: iso(-2000),
        time: "08:00:00",
        source: "engine",
        title: "Recorded fixture",
        detail: "Not a real event",
      },
    ],
    curve: [],
  };
  await harness.evaluate((data) => window.applyDesk(data), fixture);
  assert.equal(await harness.locator("#action-title img").count(), 0);
  assert.equal(await harness.locator("#factors svg").count(), 0);
  assert.match(await harness.locator("#action-title").innerText(), /<img/);
  results.htmlInjectionBlocked = true;
  await harness.getByRole("tab", { name: "M5", exact: true }).click();
  await harness.locator("#motion").click();
  await harness.locator("#log").dispatchEvent("wheel", { deltaY: -1 });
  for (let i = 0; i < 4; i++)
    await harness.evaluate((data) => window.applyDesk(data), fixture);
  assert.equal(await harness.locator("#log .event").count(), 1);
  assert.equal(
    await harness
      .getByRole("tab", { name: "M5", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  assert.equal(
    await harness.locator("#motion").getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(
    await harness.locator("#follow").getAttribute("aria-pressed"),
    "false",
  );
  results.duplicatePollsDoNotCreateEvents = true;
  const late = {
    ...fixture,
    events: [
      { ...fixture.events[0], id: "later", at: iso(-1000) },
      { ...fixture.events[0], id: "earlier", at: iso(-3000) },
    ],
  };
  await harness.evaluate((data) => window.applyDesk(data), late);
  assert.deepEqual(
    await harness
      .locator("#log .event")
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.id)),
    ["earlier", "a", "later"],
  );
  results.lateEventsSorted = true;
  await harness.clock.runFor(11000);
  assert.equal(await harness.locator("#open-net").innerText(), "Unavailable");
  assert.match(
    await harness.locator("#positions").innerText(),
    /Broker SL Unavailable/,
  );
  assert.match(await harness.locator("#session").innerText(), /UNAVAILABLE/);
  assert.equal(
    await harness
      .locator("#factors .fact")
      .filter({ hasText: "Current spread" })
      .locator("strong")
      .innerText(),
    "Unavailable",
  );
  results.independentClientFreshness = true;
  await harness.clock.runFor(20000);
  assert.equal(
    await harness.locator("#action-title").innerText(),
    "Data unavailable",
  );
  assert.equal(await harness.locator("#equity").innerText(), "Unavailable");
  assert.equal(await harness.locator("#position-state").innerText(), "UNKNOWN");
  results.disconnectedClientFailsClosed = true;
  await harness.evaluate(() => window.applyDesk({ available: false }));
  assert.equal(await harness.locator("#open-net").innerText(), "Unavailable");
  results.partialPayloadFailsClosed = true;
  const many = {
    ...fixture,
    capturedAt: iso(31000),
    expiresAt: iso(60000),
    events: Array.from({ length: 200 }, (_, i) => ({
      id: `bounded-${i}`,
      at: iso(i - 5000),
      time: "08:00:00",
      source: "engine",
      title: "Synthetic capacity check",
      detail: "Not a real event",
    })),
  };
  await harness.evaluate((data) => window.applyDesk(data), many);
  assert.equal(await harness.locator("#log .event").count(), 160);
  results.eventRetentionBounded = true;
  await harness.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await harness
      .locator(".orbit")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  results.reducedMotion = true;
  await harness.getByLabel("Enter fullscreen", { exact: true }).click();
  await harness.waitForFunction(() => !!document.fullscreenElement);
  await harness.getByLabel("Exit fullscreen", { exact: true }).click();
  await harness.waitForFunction(() => !document.fullscreenElement);
  results.fullscreen = true;
  assert.deepEqual(harnessErrors, []);
  assert.deepEqual(requests, []);
  results.harnessPageErrors = 0;
  results.harnessExternalRequests = 0;
  await harness.close();
  fs.writeFileSync(
    path.join(output, "browser-results.json"),
    JSON.stringify(results, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
