import { APP_IDS, MODULE_ID, SETTINGS } from "../constants.js";

const STOP_WORDS = new Set([
  "the", "and", "what", "where", "when", "who", "how", "about", "know", "with", "from", "that", "this", "are", "our",
  "что", "где", "когда", "кто", "как", "про", "нам", "мы", "знаем", "из", "это", "или", "для"
]);

function collectionValues(collection) {
  return Array.from(collection?.contents ?? collection?.values?.() ?? collection ?? []);
}

function flagsFor(document) {
  return document?.flags?.[MODULE_ID] ?? {};
}

export function plainText(html = "") {
  return String(html).replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

export function searchTerms(query) {
  const terms = String(query ?? "").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const useful = terms.filter(term => term.length > 2 && !STOP_WORDS.has(term));
  return useful.length ? useful : terms.filter(term => term.length > 1);
}

function slug(value) {
  return String(value ?? "record").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
}

function bodyNames(items) {
  return Array.isArray(items) ? items.map(item => item?.name ?? item?.designation ?? item?.type ?? "").filter(Boolean) : [];
}

export class SearchService {
  constructor({ dataService, permissionService, toolkitAdapter, communicationService = null } = {}) {
    this.data = dataService;
    this.permissions = permissionService;
    this.toolkit = toolkitAdapter;
    this.communications = communicationService;
  }

  journalApplications() {
    const definitions = [
      [SETTINGS.LOGS_FOLDER, APP_IDS.LOGS],
      [SETTINGS.DATABASE_FOLDER, APP_IDS.DATABASE],
      [SETTINGS.FILES_FOLDER, APP_IDS.FILES],
      [SETTINGS.COMMS_FOLDER, APP_IDS.COMMS]
    ];
    return definitions.map(([setting, appId]) => ({
      appId,
      folderIds: this.data.folderIds(this.data.configuredFolderId(setting))
    }));
  }

  async buildIndex() {
    const records = [];
    const folderApps = this.journalApplications();
    for (const entry of this.permissions.filter(game.journal)) {
      const flags = flagsFor(entry);
      const folderId = entry.folder?.id ?? entry.folder;
      const configuredApp = folderApps.find(item => item.folderIds.has(folderId))?.appId ?? null;
      const flaggedApp = Object.values(APP_IDS).includes(flags.app) ? flags.app : null;
      const appId = flaggedApp || configuredApp;
      if (appId === APP_IDS.COMMS && this.communications && !this.communications.isAddressedTo(entry)) continue;
      const pages = this.permissions.filter(entry.pages);
      const pageText = pages.map(page => plainText(page.text?.content ?? "")).join(" ");
      const tags = Array.isArray(flags.tags) ? flags.tags.join(" ") : flags.tags ?? "";
      const path = flags.terminalPath || `/${appId || "records"}/${slug(entry.name)}`;
      records.push({
        id: entry.id,
        uuid: entry.uuid,
        type: appId === APP_IDS.LOGS ? "log" : appId === APP_IDS.FILES ? "file" : appId === APP_IDS.COMMS ? "communication" : "journal",
        appId,
        title: entry.name,
        path,
        text: [entry.name, pageText, flags.category, tags, path].filter(Boolean).join(" "),
        excerpt: pageText.slice(0, 220)
      });
    }

    for (const actor of this.permissions.filter(game.actors)) {
      if (this.toolkit.isStarSystemActor(actor)) {
        const system = this.toolkit.getStarSystemData(actor);
        const path = `/astrometrics/${slug(system.sector || system.region || "unknown")}/${slug(system.designation)}`;
        const fields = [system.designation, system.sector, system.region, system.affiliation, system.travelCode,
          system.strategicValue, system.primaryStar, ...bodyNames(system.worlds)];
        records.push({
          id: actor.id, actorId: actor.id, uuid: actor.uuid, type: "star-system", appId: APP_IDS.ASTROMETRICS,
          title: system.designation, path, text: fields.filter(Boolean).join(" "),
          excerpt: [system.classification, system.sector, system.affiliation, system.travelCode].filter(Boolean).join(" · ")
        });
        continue;
      }
      const flags = flagsFor(actor);
      const isCrew = flags.app === APP_IDS.CREW || actor.hasPlayerOwner || actor.type === "character";
      const appId = flags.app === APP_IDS.DATABASE ? APP_IDS.DATABASE : isCrew ? APP_IDS.CREW : null;
      const description = plainText(actor.system?.description?.value ?? actor.system?.biography?.value ?? actor.system?.biography ?? actor.system?.notes ?? "");
      const path = flags.terminalPath || `/${appId}/${slug(actor.name)}`;
      records.push({
        id: actor.id, uuid: actor.uuid, type: appId === APP_IDS.CREW ? "crew" : "actor", appId,
        title: actor.name, path,
        text: [actor.name, description, flags.category, flags.tags, flags.role, flags.species, path].filter(Boolean).join(" "),
        excerpt: description.slice(0, 220)
      });
    }
    return records;
  }

  async search(query, { types = [], appIds = [], limit = 30 } = {}) {
    const terms = searchTerms(query);
    if (!terms.length) return [];
    const records = await this.buildIndex();
    return records
      .filter(record => !types.length || types.includes(record.type))
      .filter(record => !appIds.length || appIds.includes(record.appId))
      .map(record => {
        const title = record.title.toLocaleLowerCase();
        const path = record.path.toLocaleLowerCase();
        const text = record.text.toLocaleLowerCase();
        let score = 0;
        for (const term of terms) {
          if (title.includes(term)) score += 8;
          if (path.includes(term)) score += 4;
          if (text.includes(term)) score += 1;
        }
        return { ...record, score };
      })
      .filter(record => record.score > 0)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, limit);
  }

  async resolvePath(path) {
    const normalized = String(path ?? "").replace(/\/+$/, "").toLocaleLowerCase();
    return (await this.buildIndex()).find(record => record.path.replace(/\/+$/, "").toLocaleLowerCase() === normalized) ?? null;
  }
}
