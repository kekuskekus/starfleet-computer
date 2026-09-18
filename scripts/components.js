export function makeList(items = [], options = {}) {
  return { type: "list", items: Array.from(items), ...options };
}

export function makeCard({ id, title, subtitle = "", image = "", body = "", meta = [], actions = [] }) {
  return { type: "card", id, title, subtitle, image, body, meta, actions };
}

export function makeDirectory(path, entries = []) {
  const normalized = String(path || "/").replace(/\\/g, "/");
  return { type: "directory", path: normalized.startsWith("/") ? normalized : `/${normalized}`, entries };
}

export function makeDocumentViewer(document, html = "") {
  return { type: "document-viewer", uuid: document?.uuid ?? "", title: document?.name ?? "", html };
}

export function makeTerminalOutput(lines = [], tone = "normal") {
  return { type: "terminal-output", lines: Array.from(lines), tone };
}

export function makeNavigationButton(app, active = false) {
  return { type: "navigation-button", ...app, active };
}

export function makeStatusIndicator(label, state = "nominal") {
  return { type: "status-indicator", label, state };
}

export function makeDocumentLink(document, label = document?.name ?? "") {
  return { type: "document-link", uuid: document?.uuid ?? "", label };
}

export function makeStarSystemLink(system, label = system?.designation ?? system?.name ?? "") {
  return { type: "star-system-link", actorId: system?.actorId ?? system?.id ?? "", label };
}
