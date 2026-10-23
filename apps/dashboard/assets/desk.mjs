// Same-origin read-only polling; keep the desk and animation controller mounted.
import render from "./landscape.mjs";

const root = document.body;
let cleanup = render({ data: {}, parentElement: root });
let stopped = false;
let selection = null;
let operatorToken = ""; // Memory only: never URL, localStorage, cookies or snapshot.
let changing = false;
let pendingRevision = null,
  pendingUntil = 0;
const modeButtons = [...document.querySelectorAll("[data-entry-mode]")];
const modeStatus = document.getElementById("entry-mode-status");
const unlock = document.getElementById("entry-unlock");
const dialog = document.getElementById("entry-unlock-dialog");
function modes(data) {
  if (
    pendingRevision &&
    data.entryMode?.revision !== pendingRevision &&
    Date.now() < pendingUntil
  ) {
    for (const button of modeButtons) button.disabled = true;
    modeStatus.textContent = "Saved · awaiting fresh status";
    return;
  }
  pendingRevision = null;
  selection =
    data.available && Date.now() <= Date.parse(data.expiresAt)
      ? data.entryMode
      : null;
  for (const button of modeButtons) {
    button.setAttribute(
      "aria-pressed",
      String(selection?.mode === button.dataset.entryMode),
    );
    button.disabled = changing || !selection || !operatorToken;
  }
  if (!changing)
    modeStatus.textContent = selection
      ? {
          READY: "New setups only",
          ACTIVE: "Active setup",
          QUEUED: "Queued · after current setup",
          RESTARTING: "Restarting analysis",
          UNVERIFIED: "Awaiting reconciliation",
        }[selection.phase] || "New setups only"
      : "Mode unavailable";
}
unlock.addEventListener("click", () => {
  if (operatorToken) {
    operatorToken = "";
    unlock.textContent = "Unlock";
    modes({});
  } else dialog.showModal();
});
document
  .getElementById("entry-unlock-cancel")
  .addEventListener("click", () => dialog.close());
document.getElementById("entry-unlock-form").addEventListener("submit", () => {
  operatorToken = document.getElementById("entry-token").value;
  document.getElementById("entry-token").value = "";
  unlock.textContent = "Lock";
});
for (const button of modeButtons)
  button.addEventListener("click", async () => {
    if (!selection || !operatorToken || changing) return;
    changing = true;
    for (const b of modeButtons) b.disabled = true;
    modeStatus.textContent = "Saving selection…";
    try {
      const response = await fetch("./api/entry-mode", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-control-token": operatorToken,
        },
        body: JSON.stringify({
          mode: button.dataset.entryMode,
          expectedRevision: selection.revision,
        }),
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) {
        if (response.status === 401) {
          operatorToken = "";
          unlock.textContent = "Unlock";
        }
        throw new Error("MODE_NOT_SAVED");
      }
      const result = await response.json();
      selection = result.entryMode;
      pendingRevision = selection.revision;
      pendingUntil = Date.now() + 6000;
      for (const b of modeButtons)
        b.setAttribute(
          "aria-pressed",
          String(selection.mode === b.dataset.entryMode),
        );
      modeStatus.textContent = "Saved · next setup";
    } catch {
      modeStatus.textContent = "Not saved · refresh or unlock";
      selection = null;
    } finally {
      changing = false;
    }
  });

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
  modes(data);
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
