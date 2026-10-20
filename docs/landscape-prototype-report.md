# ISSUE-342 — Animated landscape design prototype

Issue: https://github.com/AegisFintech/scalping-bot/issues/342.
Status: visual review prototype; the deployed dashboard has not been replaced.

[Open the interactive HTML](prototypes/landscape-desk.html) in a browser, or view
[the landscape screenshot](images/landscape-prototype.png) and
[the six-second animation](images/landscape-prototype.gif). The HTML is self-contained:
no installation, external fonts, libraries, network requests or credentials.

The operator requested a full visual overhaul following the supplied video:
a one-page landscape desk, animated central bot, clearly separated panels and a
moving decision tape. The agreed first step is a visual prototype for review
before production implementation. This is that review artifact, not a claim that
simulated data is now live telemetry.

## Design and interaction

The full-width desktop fills 1920×1080, 1440×900 and 1280×720. Six coloured workflow
stages surround a decorative animated engine. The actual action and next step sit
below the engine; the central decision tape appends timestamped fixture events
and follows the newest row. Scrolling upward pauses follow, and a separate button
resumes it. Event retention is bounded to 60 rows. Replay and decorative motion
can be paused separately. Reduced-motion preferences disable animation. Charts
have keyboard-operable M1/M5/M15 tabs; fullscreen has an explicit control. Mobile
stacks panels with engine and tape first, without horizontal overflow.

Charts and factors sit left, engine and decision tape centre, and P/L/protection
and the closed-net curve right. Positive and negative fixture results are both
shown. Realized and unrealized amounts are separated; unknown future costs, news,
consolidated order flow and narrative model reasoning stay unavailable. The
corridor is explicitly not an exact returned holding box. Decorative rotation
is labelled as such, and data/process stage timing is not invented.

All financial values, candles and events are synthetic, and the preview is
persistently labelled. The clock is current Singapore wall time; event times are
an illustrative replay. Six explicit scenes demonstrate waiting, inference,
working orders, a position, incomplete reconciliation and unavailable reads.
The failure scene withholds current money/exposure and charts instead of
presenting a flat or healthy account. Scene changes are fixture selections and
cannot create a provider call, order, position or control request. History,
diagnostics and operator-control links explain the eventual production integration
rather than pretending to execute actions. CSP disallows connections and forms.

## Production integration after visual review

Use the existing scoped read-only snapshot as the data source, preserve monetary
Decimals and freshness checks, and add only bounded recorded lifecycle events
to the decision tape. Repeated polls are not new decisions. Event identity and
source timestamps must control deduplication/order; missing timestamps cannot
be manufactured. Current status can explain waiting, but cannot be presented as
Codex's private reasoning. Keep the real Overview / Trade history / Diagnostics
navigation and authenticated controls outside automatic updates. A stable client
surface must preserve log position, timeframe and motion state across snapshots;
avoid repeatedly recreating an iframe and resetting its animation.

The production UI will need fresh/unavailable/cold-start and event-gap handling,
HTML-safe text, no secret/account identity leakage, state continuity tests and a
separately qualified dashboard-only artifact. Visual approval does not change
strategy, risk, prompts, live authorization or research registration. This task
starts no service and makes no DB, PM2, provider, broker or frozen-source changes.

## Validation

The reusable browser check is `scripts/check-landscape-prototype.mjs` and uses an
existing Playwright installation. It opens only the local HTML. Optional
`PLAYWRIGHT_MODULE_PATH` and `PLAYWRIGHT_CHROMIUM_PATH` select installed tooling;
no dependency is added to the bot. Run:

```sh
node scripts/check-landscape-prototype.mjs /tmp/scalper-landscape-preview
```

Checks cover four viewports, next-action visibility, actual animation progression,
keyboard tabs retained across ticks, all six scenes, stale/failure withholding,
paused replay, bounded tape, manual follow, motion pause, reduced motion,
fullscreen and disconnected controls. Browser/page exceptions and external
requests must be zero. Screenshots contain only public synthetic fixtures.

Full qualification passed at `/tmp/scalper-qualification-uCRrRc/checks/results.json`:
942 Node, 94 isolated PostgreSQL and 389 Python tests, plus formatting,
lint, TypeScript/build, Python formatting/Ruff/mypy, schema/migration/fail-closed,
secret scan and npm/pip audits. Command: `PATH=/opt/scalper-node22/bin:$PATH npm run qualify`.
The optional browser command above passed with installed ARM64 Chromium; four
viewport checks, interactions and failure scenes passed with zero page exceptions
and zero external requests. The HTML was also explicitly checked with Prettier.
AST-only `graphify update .` completed (the existing pyproject zero-node warning
and graph community relabelling notice remain). No runtime dependency was added.

[Browser receipt and exact prototype SHA](evidence/landscape-prototype-browser.json)
and [qualification receipt](evidence/landscape-prototype-qualification.json).
Qualification covers the repository; the optional browser suite separately checks
the offline HTML, which is documentation and excluded from the runtime fingerprint.
This prototype is not a trading-results evaluation. Hosted final-head checks and
normal PR review still precede merge; deployment requires the agreed visual review.
