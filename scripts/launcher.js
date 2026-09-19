const MODULE_ID = "starfleet-computer";
const LAUNCHER_ID = "starfleet-computer-launcher";

function localized(key, fallback) {
  return globalThis.game?.i18n?.localize?.(key) ?? fallback;
}

async function openComputer() {
  const api = globalThis.game?.modules?.get?.(MODULE_ID)?.api;
  if (typeof api?.openComputer === "function") {
    await api.openComputer();
    return;
  }
  console.error(`${MODULE_ID} | Public API is unavailable; the main module did not finish initialization.`);
  globalThis.ui?.notifications?.error?.(
    localized("STARFLEET.Warning.ApiUnavailable", "Starfleet Computer failed to initialize. See the browser console.")
  );
}

export function mountLauncher(doc = globalThis.document) {
  if (!doc?.body) return false;
  if (doc.getElementById(LAUNCHER_ID)) return true;

  const title = localized("STARFLEET.OpenComputer", "Open Computer");
  const button = doc.createElement("button");
  button.id = LAUNCHER_ID;
  button.type = "button";
  button.className = "starfleet-computer-launcher";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.setAttribute("data-tooltip", title);
  button.innerHTML = '<i class="fa-solid fa-computer" aria-hidden="true"></i>';
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openComputer();
  });
  doc.body.append(button);
  return true;
}

function scheduleMount() {
  globalThis.setTimeout?.(() => mountLauncher(), 0);
}

// Mount immediately because this launcher has no dependency on Foundry's
// application API. The ready hook repeats the operation after UI startup.
scheduleMount();
globalThis.Hooks?.once?.("ready", mountLauncher);
globalThis.Hooks?.on?.("canvasReady", mountLauncher);
