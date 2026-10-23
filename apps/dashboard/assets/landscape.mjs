// Trusted view code. Dynamic strings enter textContent, never HTML.
function controller(root) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const $ = (id) => root.querySelector(`#${id}`);
  const desk = $("desk");
  const state = {
    model: {},
    frame: "M1",
    follow: true,
    motion: !win.matchMedia("(prefers-reduced-motion: reduce)").matches,
    events: new Map(),
    chartKey: "",
    positionKey: "",
    factorsKey: "",
    logKey: "",
    gap: false,
    stale: true,
  };
  const reduced = win.matchMedia("(prefers-reduced-motion: reduce)");
  const text = (id, value) => {
    $(id).textContent = String(value ?? "Unavailable");
  };
  function node(tag, cls, value) {
    const el = doc.createElement(tag);
    el.className = cls;
    el.textContent = value;
    return el;
  }
  function svg(tag, attrs = {}, value) {
    const el = doc.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    if (value !== undefined) el.textContent = value;
    return el;
  }
  const valid = (at) =>
    Number.isFinite(Date.parse(at)) && Date.now() <= Date.parse(at);
  const live = () => state.model.available && valid(state.model.expiresAt);
  const stages = [
    ["idle", "◇", "Ready / wait", "Safety gates", "#b7a0ff"],
    ["download", "⇣", "Market data", "Completed OHLC", "#83dbe3"],
    ["process", "⌁", "Process", "Indicators & risk", "#8abfff"],
    ["ai", "✦", "Codex", "Entry proposals", "#d49eea"],
    ["orders", "⇄", "Place entry", "Selected mode / GTC", "#f1c47c"],
    ["position", "◎", "Manage trade", "Broker SL / TP", "#64e5ba"],
  ];
  stages.forEach(([key, icon, name, detail, tone], index) => {
    const stage = node("div", "stage", "");
    stage.dataset.stage = key;
    stage.style.setProperty("--tone", tone);
    const label = node("div", "", "");
    label.append(node("strong", "", name), node("small", "", detail));
    stage.append(
      node("span", "stage-icon", icon),
      label,
      node("span", "stage-number mono", String(index + 1).padStart(2, "0")),
    );
    $("flow").append(stage);
    const orbital = node("div", `node n${index}`, "");
    orbital.dataset.stage = key;
    orbital.style.setProperty("--tone", tone);
    const info = node("div", "", "");
    info.append(
      node("strong", "", name),
      node(
        "span",
        "",
        ["download", "process"].includes(key)
          ? "Timing not observed"
          : "Observed state",
      ),
    );
    orbital.append(node("i", "", ""), info);
    $("reactor-nodes").append(orbital);
  });
  for (let i = 0; i < 42; i++)
    $(i % 2 ? "filaments" : "filaments-reverse").append(
      svg("ellipse", {
        cx: 300,
        cy: 166,
        rx: 135 + (i % 7) * 7,
        ry: 67 + (i % 5) * 5,
        transform: `rotate(${(i * 0.17 * 180) / Math.PI} 300 166)`,
        stroke: stages[i % 6][4],
        class: i % 7 === 0 ? "filament particle" : "filament",
      }),
    );
  function follow(value) {
    state.follow = value;
    $("follow").setAttribute("aria-pressed", String(value));
    text("follow", value ? "Following ↓" : "Follow paused");
    if (value) $("log").scrollTop = $("log").scrollHeight;
  }
  $("follow").onclick = () => follow(!state.follow);
  $("log").addEventListener(
    "wheel",
    (e) => {
      if (e.deltaY < 0) follow(false);
    },
    { passive: true },
  );
  $("log").addEventListener("keydown", (e) => {
    if (["ArrowUp", "PageUp", "Home"].includes(e.key)) follow(false);
  });
  $("log").addEventListener("touchmove", () => follow(false), {
    passive: true,
  });
  $("log").addEventListener("scroll", () => {
    if (
      state.follow &&
      $("log").scrollHeight - $("log").scrollTop - $("log").clientHeight > 30
    )
      follow(false);
  });
  function motion() {
    const on = state.motion && !reduced.matches;
    desk.classList.toggle("still", !on);
    text("motion", on ? "Motion on" : "Motion off");
    $("motion").setAttribute("aria-pressed", String(on));
  }
  $("motion").onclick = () => {
    state.motion = !state.motion;
    motion();
  };
  $("fullscreen").onclick = async () => {
    try {
      if (doc.fullscreenElement) await doc.exitFullscreen();
      else await desk.requestFullscreen();
    } catch {
      text("snapshot-time", "Fullscreen unavailable in this browser");
    }
  };
  function fullscreen() {
    $("fullscreen").setAttribute(
      "aria-label",
      doc.fullscreenElement ? "Exit fullscreen" : "Enter fullscreen",
    );
  }
  root.querySelectorAll("[data-frame]").forEach((button) => {
    button.onclick = () => {
      state.frame = button.dataset.frame;
      tick();
    };
    button.onkeydown = (e) => {
      if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const tabs = [...root.querySelectorAll("[data-frame]")];
      let i = tabs.indexOf(button);
      i =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? 2
            : (i + (e.key === "ArrowRight" ? 1 : 2)) % 3;
      state.frame = tabs[i].dataset.frame;
      tick();
      tabs[i].focus();
    };
  });
  function drawChart(m, isLive) {
    root.querySelectorAll("[data-frame]").forEach((b) => {
      const selected = b.dataset.frame === state.frame;
      b.setAttribute("aria-selected", String(selected));
      b.tabIndex = selected ? 0 : -1;
    });
    $("price-chart").setAttribute("aria-labelledby", `tab-${state.frame}`);
    const rows = isLive ? m.charts?.[state.frame] || [] : [];
    const overlays = (m.overlays || []).filter(
      (v) => !v.until || valid(v.until),
    );
    const key = JSON.stringify([state.frame, rows, overlays, isLive]);
    if (key === state.chartKey) return;
    state.chartKey = key;
    $("price-chart").replaceChildren();
    text(
      "level-key",
      overlays.map((v) => `${v.label}: ${v.price}`).join(" · ") ||
        "No verified levels available",
    );
    text(
      "chart-source",
      `${m.chartSource || "Recorded setup snapshot"} · ${m.chartAt || "Unavailable"} · Historical completed candles, not a live feed. Corridor = buffered entry range, not exact AI box.`,
    );
    if (!rows.length) {
      $("price-chart").append(
        node("p", "muted", "Completed chart unavailable for this snapshot."),
      );
      return;
    }
    const prices = rows
      .flatMap((r) => [Number(r.high), Number(r.low)])
      .concat(overlays.map((v) => Number(v.price)));
    if (prices.some((v) => !Number.isFinite(v) || v <= 0)) {
      $("price-chart").append(
        node("p", "muted", "Chart withheld: invalid numeric evidence."),
      );
      return;
    }
    const max = Math.max(...prices),
      min = Math.min(...prices),
      pad = Math.max((max - min) * 0.09, 0.001),
      upper = max + pad,
      lower = min - pad;
    const chart = svg("svg", {
      viewBox: "0 0 400 240",
      role: "img",
      "aria-label": `${state.frame} recorded completed candles`,
    });
    const y = (v) => 12 + ((upper - v) / (upper - lower)) * 200;
    for (let i = 0; i < 5; i++) {
      const p = lower + ((upper - lower) * i) / 4;
      chart.append(
        svg("line", { x1: 0, x2: 342, y1: y(p), y2: y(p), stroke: "#272b3b" }),
        svg(
          "text",
          { x: 348, y: y(p) + 3, fill: "#a3a8bb", "font-size": 9 },
          p.toFixed(2),
        ),
      );
    }
    const buy = overlays.find(
        (v) => v.role === "range_upper" || v.label === "Codex BUY breakout",
      ),
      sell = overlays.find(
        (v) => v.role === "range_lower" || v.label === "Codex SELL breakout",
      );
    if (buy && sell && Number(buy.price) > Number(sell.price))
      chart.append(
        svg("rect", {
          x: 0,
          y: y(Number(buy.price)),
          width: 342,
          height: y(Number(sell.price)) - y(Number(buy.price)),
          fill: "#b7a0ff",
          opacity: 0.06,
        }),
      );
    const step = 340 / rows.length;
    rows.forEach((r, i) => {
      const open = Number(r.open),
        close = Number(r.close),
        high = Number(r.high),
        low = Number(r.low),
        x = 3 + i * step + step * 0.5,
        tone = close >= open ? "#64d6b0" : "#e186a2";
      const g = svg("g");
      g.append(
        svg(
          "title",
          {},
          `${r.label} · O ${r.open} H ${r.high} L ${r.low} C ${r.close}`,
        ),
        svg("line", { x1: x, x2: x, y1: y(high), y2: y(low), stroke: tone }),
        svg("rect", {
          x: x - step * 0.28,
          y: y(Math.max(open, close)),
          width: Math.max(0.8, step * 0.56),
          height: Math.max(1.3, Math.abs(y(open) - y(close))),
          fill: tone,
          rx: 0.5,
        }),
      );
      chart.append(g);
    });
    overlays.forEach((v) =>
      chart.append(
        svg("line", {
          x1: 0,
          x2: 342,
          y1: y(Number(v.price)),
          y2: y(Number(v.price)),
          stroke: v.side === "BUY" ? "#64e5ba" : "#ff8d9e",
          "stroke-dasharray": v.label.includes("broker") ? "2 3" : "5 5",
          opacity: 0.65,
        }),
      ),
    );
    for (const [index, x] of [
      [0, 2],
      [Math.floor(rows.length / 2), 130],
      [rows.length - 1, 265],
    ])
      chart.append(
        svg(
          "text",
          { x, y: 235, fill: "#a3a8bb", "font-size": 8 },
          rows[index].label,
        ),
      );
    $("price-chart").append(chart);
  }
  function drawCurve(m, isLive) {
    const rows = isLive ? m.curve || [] : [];
    const key = JSON.stringify(rows);
    if ($("net-chart").dataset.key === key) return;
    $("net-chart").dataset.key = key;
    $("net-chart").replaceChildren();
    text(
      "curve-summary",
      rows.length
        ? `Latest ${rows.length} closed outcomes · cumulative from first shown; not account equity`
        : "No verified closed outcomes",
    );
    if (!rows.length) return;
    const nums = rows.map((r) => Number(r.net));
    if (nums.some((v) => !Number.isFinite(v))) return;
    const min = Math.min(0, ...nums),
      max = Math.max(0, ...nums),
      range = Math.max(max - min, 0.001),
      coords = nums.map(
        (v, i) =>
          `${5 + (i * 340) / Math.max(1, nums.length - 1)},${85 - ((v - min) / range) * 75}`,
      );
    const el = svg("svg", {
      viewBox: "0 0 350 90",
      preserveAspectRatio: "none",
    });
    el.append(
      svg("path", {
        d: `M${coords.join(" L")}`,
        fill: "none",
        stroke: "#b7a0ff",
        "stroke-width": 1.5,
        "vector-effect": "non-scaling-stroke",
      }),
    );
    $("net-chart").append(el);
  }
  function positions(m, isLive) {
    const ps = isLive ? m.positions || [] : [],
      orders = isLive ? m.orders || [] : [];
    const known = isLive && m.exposureKnown;
    text(
      "position-state",
      known
        ? ps.length
          ? "ACTIVE"
          : orders.length
            ? "PENDING"
            : "FLAT LEDGER"
        : "UNKNOWN",
    );
    text(
      "position-side",
      known
        ? `${ps.length} ledger position${ps.length === 1 ? "" : "s"} · ${orders.length} working order${orders.length === 1 ? "" : "s"}`
        : "Exposure unavailable · do not assume flat",
    );
    text("position-badge", known ? m.mode + " · JOURNAL" : "UNVERIFIED");
    const data = ps.map((p) => ({ ...p, protectionFresh: valid(p.until) }));
    const key = JSON.stringify([data, orders, isLive]);
    if (key === state.positionKey) return;
    state.positionKey = key;
    $("positions").replaceChildren();
    $("orders").replaceChildren();
    for (const p of data) {
      const row = node("div", "position-row", "");
      const verified =
        p.protectionFresh &&
        (p.protection === "Verified broker" || p.protection === "Simulated");
      row.append(
        node("b", "", `${p.side} · ${p.state} · native volume ${p.volume}`),
        doc.createElement("br"),
        node(
          "span",
          "",
          `Fill ${p.entry} · ${verified ? p.protection : "Protection unverified / stale"}`,
        ),
        doc.createElement("br"),
        node(
          "span",
          "",
          `Broker SL ${verified ? p.sl : "Unavailable"} / TP ${verified ? p.tp : "Unavailable"}`,
        ),
      );
      $("positions").append(row);
    }
    for (const o of orders) {
      const row = node("div", "position-row", "");
      row.append(
        node(
          "b",
          "",
          `${o.side} · ${o.orderType || "Unknown type"} · ${o.state} · ${o.tif}`,
        ),
        doc.createElement("br"),
        node(
          "span",
          "",
          `Trigger ${o.entry} · intended SL ${o.sl} / TP ${o.tp}`,
        ),
      );
      $("orders").append(row);
    }
  }
  function factors(m, isLive) {
    const items = isLive
      ? (m.factors || []).map(([k, v]) => [
          k,
          m.factorUntil &&
          Object.hasOwn(m.factorUntil, k) &&
          !valid(m.factorUntil[k])
            ? "Unavailable"
            : v,
        ])
      : [];
    const key = JSON.stringify(items);
    if (key === state.factorsKey) return;
    state.factorsKey = key;
    const scrollTop = $("factors").scrollTop;
    $("factors").replaceChildren();
    if (!items.length)
      $("factors").append(node("p", "muted", "Recorded factors unavailable."));
    for (const [k, v] of items) {
      const row = node("div", "fact", "");
      row.append(node("span", "", k), node("strong", "", v));
      $("factors").append(row);
    }
    $("factors").scrollTop = scrollTop;
  }
  function events(m) {
    const incoming = m.events || [];
    for (const e of incoming) state.events.set(e.id, e);
    const all = [...state.events.values()].sort(
      (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
    );
    while (all.length > 160) state.events.delete(all.shift().id);
    const key = JSON.stringify(all.map((e) => e.id));
    if (key === state.logKey) return;
    state.logKey = key;
    const log = $("log"),
      scroll = log.scrollTop,
      oldHeight = log.scrollHeight;
    // Retain existing row nodes, including animation progress, across ordinary polls.
    const nodes = new Map([...log.children].map((el) => [el.dataset.id, el]));
    const keep = new Set(all.map((e) => e.id));
    for (const [id, el] of nodes) if (!keep.has(id)) el.remove();
    let cursor = log.firstElementChild;
    for (const e of all) {
      let row = nodes.get(e.id);
      if (!row) {
        row = node("div", "event", "");
        row.dataset.id = e.id;
        const message = node("div", "message", "");
        message.append(
          node("b", "", e.title),
          doc.createTextNode(" " + e.detail),
        );
        row.append(
          node("time", "", e.time),
          node("span", `source ${e.source}`, e.source.toUpperCase()),
          message,
        );
      }
      if (row !== cursor) log.insertBefore(row, cursor);
      cursor = row.nextElementSibling;
    }
    if (state.follow) log.scrollTop = log.scrollHeight;
    else
      log.scrollTop = Math.max(
        0,
        scroll + Math.min(0, log.scrollHeight - oldHeight),
      );
    text("log-count", `${all.length} RECORDED`);
  }
  function tick() {
    const m = state.model,
      isLive = live();
    if (!isLive && state.stale === false) state.gap = true;
    state.stale = !isLive;
    desk.classList.toggle("unavailable", !isLive);
    text(
      "clock",
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Singapore",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(new Date()) + " +08",
    );
    text("mode", m.mode || "UNKNOWN");
    text(
      "session",
      `SESSION ${isLive && valid(m.sessionUntil) ? m.session : "UNAVAILABLE"}`,
    );
    text(
      "identity",
      `${m.symbol || "Unavailable symbol"} · ${m.currency || "Currency unavailable"} · GMT+8`,
    );
    text(
      "snapshot-time",
      isLive
        ? `Observed ${new Date(m.capturedAt).toLocaleTimeString("en-GB", { timeZone: "Asia/Singapore", hour12: false })} GMT+8 · read-only`
        : "Current data unavailable · automatic read-only checks continue",
    );
    for (const id of [
      "equity",
      "day-net",
      "ceiling",
      "open-net",
      "position-pnl",
      "quote",
      "ask",
      "closed-net",
    ]) {
      const v = m.values?.[id] || {};
      const ok = isLive && valid(v.until);
      text(id, ok ? v.text : "Unavailable");
      $(id).className =
        `${["position-pnl"].includes(id) ? "big-pnl mono" : id === "closed-net" ? "net-number mono" : "mono"} ${ok && v.text !== "Unavailable" ? v.tone : "neutral"}`;
    }
    for (const id of [
      "equity",
      "day-net",
      "ceiling",
      "open-net",
      "closed-net",
      "position-pnl",
    ]) {
      const v = m.values?.[id];
      $(id).classList.toggle(
        "empty-value",
        !isLive || !valid(v?.until) || v?.text === "Unavailable",
      );
    }
    const title = isLive
      ? m.title
      : m.title === "Connecting"
        ? "Connecting"
        : "Data unavailable";
    text("top-action", title);
    text("action-title", title);
    text(
      "action-detail",
      isLive
        ? m.detail
        : "Current balances, exposure and session state cannot be verified.",
    );
    text(
      "top-detail",
      isLive ? m.detail : "Waiting for fresh read-only evidence",
    );
    text(
      "next-action",
      isLive
        ? m.next
        : "Retry read-only polling; do not infer a flat account or recovered safety state.",
    );
    text(
      "reasons",
      isLive
        ? [m.reasons, ...(m.warnings || [])].filter(Boolean).join(" · ")
        : "Stale or unavailable observations are withheld.",
    );
    text("engine-badge", isLive ? m.stage || "WAITING" : "UNAVAILABLE");
    root.querySelectorAll("[data-stage]").forEach((el) => {
      const active = isLive && el.dataset.stage === m.stage;
      el.classList.toggle("active", active);
      if (active) el.setAttribute("aria-current", "step");
      else el.removeAttribute("aria-current");
    });
    text("equity-label", `ACCOUNT EQUITY · ${m.currency || "UNAVAILABLE"}`);
    text(
      "budget-label",
      `SHARED SETUP BUDGET · ${m.currency || "UNAVAILABLE"}`,
    );
    text("curve-unit", m.currency || "Unavailable currency");
    text("strategy", m.strategy || "Strategy unavailable");
    text("quote-symbol", `${m.symbol || "Unavailable"} · BID`);
    const pnlFresh = isLive && valid(m.pnlUntil);
    text(
      "pnl-detail",
      pnlFresh
        ? `Gross ${m.gross} · signed commission ${m.commission}`
        : "Gross / signed commission unavailable",
    );
    text("status-health", isLive ? "Observed" : "Unavailable");
    text(
      "quote-health",
      isLive &&
        valid(m.values?.quote?.until) &&
        m.values?.quote?.text !== "Unavailable"
        ? "Fresh"
        : "Unavailable",
    );
    text(
      "event-window",
      (state.gap ? "Observation gap possible · " : "") +
        (m.eventWindow ||
          "Bounded journal history unavailable; old rows remain historical."),
    );
    drawChart(m, isLive);
    drawCurve(m, isLive);
    positions(m, isLive);
    factors(m, isLive);
    motion();
  }
  return {
    update(m) {
      state.model = m || {};
      events(state.model);
      tick();
    },
    tick,
    motion,
    fullscreen,
    reduced,
    win,
    doc,
  };
}
export default function ({ data, parentElement }) {
  const desk = parentElement.querySelector("#desk");
  if (!desk.scalperDesk) desk.scalperDesk = controller(parentElement);
  const deskController = desk.scalperDesk;
  deskController.update(data);
  const timer = deskController.win.setInterval(deskController.tick, 1000);
  deskController.reduced.addEventListener("change", deskController.motion);
  deskController.doc.addEventListener(
    "fullscreenchange",
    deskController.fullscreen,
  );
  return () => {
    deskController.win.clearInterval(timer);
    deskController.reduced.removeEventListener("change", deskController.motion);
    deskController.doc.removeEventListener(
      "fullscreenchange",
      deskController.fullscreen,
    );
  };
}
