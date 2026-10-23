// Same-origin read-only polling; keep the desk and animation controller mounted.
import render from "./landscape.mjs";

const root = document.body;
let cleanup = render({ data: {}, parentElement: root });
let stopped = false;
async function poll() {
  let data = {};
  try {
    const response = await fetch("./api/desk", {
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("DESK_UNAVAILABLE");
    data = await response.json();
  } catch {
    // Withdraw current evidence on transport failure; retained tape is historical.
  }
  if (stopped) return;
  cleanup?.();
  cleanup = render({ data, parentElement: root });
  setTimeout(poll, 2000);
}
window.addEventListener("pagehide", () => {
  stopped = true;
  cleanup?.();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) window.location.reload();
});
poll();
