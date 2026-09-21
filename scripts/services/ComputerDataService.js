import { MODULE_ID, SETTINGS } from "../constants.js";
import { getSetting } from "../settings.js";

function getComputerFlags(document) {
  return document?.getFlag?.(MODULE_ID, "metadata") ?? document?.flags?.[MODULE_ID] ?? {};
}

function getProperty(object, paths, fallback = "") {
  for (const path of paths) {
    const value = path.split(".").reduce((current, key) => current?.[key], object);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function stripHtml(html = "") {
  const div = globalThis.document?.createElement?.("div");
  if (div) {
    div.innerHTML = html;
    return div.textContent?.trim() ?? "";
  }
  return String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function collectionValues(collection) {
  return Array.from(collection?.contents ?? collection?.values?.() ?? collection ?? []);
}

export class ComputerDataService {
  constructor({ permissionService, toolkitAdapter, settingProvider = getSetting } = {}) {
    this.permissions = permissionService;
    this.toolkit = toolkitAdapter;
    this.settingProvider = settingProvider;
  }

  configuredFolderId(settingKey) {
    const raw = String(this.settingProvider(settingKey) ?? "").trim();
    return raw.split(".").at(-1) || "";
  }

  folderIds(rootId, type = "JournalEntry") {
    if (!rootId) return new Set();
    const folders = collectionValues(game.folders).filter(folder => folder.type === type);
    const ids = new Set([rootId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of folders) {
        const parentId = folder.folder?.id ?? folder.parent?.id ?? folder.folder ?? null;
        if (parentId && ids.has(parentId) && !ids.has(folder.id)) {
          ids.add(folder.id);
          changed = true;
        }
      }
    }
    return ids;
  }

  journalsFor(settingKey) {
    const ids = this.folderIds(this.configuredFolderId(settingKey));
    if (!ids.size) return [];
    return this.permissions.filter(game.journal).filter(entry => ids.has(entry.folder?.id ?? entry.folder));
  }

  async pageHtml(page) {
    const raw = page?.text?.content ?? "";
    if (!raw) return "";
    if (globalThis.foundry?.applications?.ux?.TextEditor?.enrichHTML) {
      return foundry.applications.ux.TextEditor.enrichHTML(raw, { async: true, relativeTo: page });
    }
    if (globalThis.TextEditor?.enrichHTML) return TextEditor.enrichHTML(raw, { async: true, relativeTo: page });
    return raw;
  }

  async journalRecord(entry, kind) {
    const flags = getComputerFlags(entry);
    const pages = this.permissions.filter(entry.pages ?? []);
    const renderedPages = await Promise.all(pages.map(page => this.pageHtml(page)));
    const body = renderedPages.filter(Boolean).join("");
    const pageFlags = pages[0] ? getComputerFlags(pages[0]) : {};
    return {
      id: entry.id,
      uuid: entry.uuid,
      kind,
      title: entry.name,
      image: entry.img ?? "",
      author: flags.author || pageFlags.author || entry.author?.name || "—",
      date: flags.stardate || flags.date || pageFlags.stardate || pageFlags.date || "—",
      category: flags.category || pageFlags.category || "general",
      terminalPath: flags.terminalPath || "",
      order: Number(flags.order ?? 0),
      html: body,
      excerpt: stripHtml(body).slice(0, 240)
    };
  }

  async getDatabaseEntries() {
    const journals = await Promise.all(this.journalsFor(SETTINGS.DATABASE_FOLDER).map(entry => this.journalRecord(entry, "journal")));
    const systems = this.toolkit.getStarSystems({ permissionService: this.permissions }).map(system => ({
      id: system.actorId,
      uuid: system.uuid,
      kind: "star-system",
      title: system.designation,
      category: system.sector || system.region || "Star Systems",
      excerpt: [system.classification, system.affiliation, system.travelCode].filter(Boolean).join(" · "),
      system
    }));
    const actors = this.permissions.filter(game.actors)
      .filter(actor => !this.toolkit.isStarSystemActor(actor))
      .filter(actor => getComputerFlags(actor).app === "database")
      .map(actor => ({
        id: actor.id,
        uuid: actor.uuid,
        kind: "actor",
        title: actor.name,
        category: getComputerFlags(actor).category || "People",
        excerpt: stripHtml(getProperty(actor, ["system.description.value", "system.biography.value", "system.notes"], "")).slice(0, 240)
      }));
    return [...journals, ...systems, ...actors].sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  }

  getCrewActors({ permitted = true } = {}) {
    const folderId = this.configuredFolderId(SETTINGS.CREW_FOLDER);
    const folderIds = this.folderIds(folderId, "Actor");
    if (!folderIds.size) return [];
    const actors = permitted ? this.permissions.filter(game.actors) : collectionValues(game.actors);
    return actors
      .filter(actor => !this.toolkit.isStarSystemActor(actor))
      .filter(actor => folderIds.has(actor.folder?.id ?? actor.folder));
  }

  isCrewActor(actor) {
    if (!actor || this.toolkit.isStarSystemActor(actor)) return false;
    const folderIds = this.folderIds(this.configuredFolderId(SETTINGS.CREW_FOLDER), "Actor");
    return folderIds.has(actor.folder?.id ?? actor.folder);
  }

  getCrewFolderOptions() {
    const selectedId = this.configuredFolderId(SETTINGS.CREW_FOLDER);
    const folders = collectionValues(game.folders).filter(folder => folder.type === "Actor");
    const byId = new Map(folders.map(folder => [folder.id, folder]));
    const pathFor = folder => {
      const names = [folder.name];
      const visited = new Set([folder.id]);
      let parentId = folder.folder?.id ?? folder.parent?.id ?? folder.folder ?? null;
      while (parentId && byId.has(parentId) && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = byId.get(parentId);
        names.unshift(parent.name);
        parentId = parent.folder?.id ?? parent.parent?.id ?? parent.folder ?? null;
      }
      return names.join(" / ");
    };
    return folders
      .map(folder => ({ value: folder.id, label: pathFor(folder), selected: folder.id === selectedId }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  getCrew() {
    return this.getCrewActors()
      .map(actor => {
        const flags = getComputerFlags(actor);
        const description = getProperty(actor, ["system.description.value", "system.biography.value", "system.biography", "system.notes"], "");
        return {
          id: actor.id,
          uuid: actor.uuid,
          name: actor.name,
          image: actor.img,
          role: flags.role || getProperty(actor, ["system.role", "system.assignment", "system.rank.value", "system.rank"], "—"),
          species: flags.species || getProperty(actor, ["system.species.name", "system.species", "system.ancestry.name"], "—"),
          description: stripHtml(description).slice(0, 320)
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
  }

  getWorldName() {
    return game.world?.title || game.world?.id || "UNKNOWN VESSEL";
  }
}
