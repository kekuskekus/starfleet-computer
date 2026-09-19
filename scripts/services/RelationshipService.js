import { APP_IDS, MODULE_ID, SETTINGS } from "../constants.js";
import { getSetting } from "../settings.js";

export const RELATIONSHIP_APP = "relationship";
const RELATIONSHIP_FOLDER_KIND = "relationships";
const RELATIONSHIP_PAGE_KIND = "relationship-history";

function collectionValues(collection) {
  return Array.from(collection?.contents ?? collection?.values?.() ?? collection ?? []);
}

function flagsFor(document) {
  return document?.flags?.[MODULE_ID] ?? {};
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function localize(key, fallback) {
  const value = globalThis.game?.i18n?.localize?.(key);
  return value && value !== key ? value : fallback;
}

function randomId() {
  return globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function scoreTone(score) {
  return score > 0 ? "positive" : score < 0 ? "negative" : "neutral";
}

function historyHtml(name, history) {
  const rows = history.map(item => {
    const sign = item.delta > 0 ? "+" : "";
    return `<li><strong>${sign}${item.delta}: ${item.previous} → ${item.value}</strong>`
      + `<br>${escapeHtml(item.reason)}<br><small>${escapeHtml(item.userName)} · ${escapeHtml(item.timestamp)}</small></li>`;
  }).join("");
  return `<h1>${escapeHtml(localize("STARFLEET.Relations.JournalTitle", "Relationship"))}: ${escapeHtml(name)}</h1>`
    + `<p>${escapeHtml(localize("STARFLEET.Relations.CurrentScore", "Current score"))}: <strong>${history.at(-1)?.value ?? 0}</strong></p>`
    + `<ol>${rows}</ol>`;
}

export class RelationshipService {
  constructor({
    permissionService,
    toolkitAdapter,
    settingProvider = getSetting,
    settingWriter = (key, value) => game.settings.set(MODULE_ID, key, value),
    folderCreator = data => Folder.create(data),
    journalCreator = data => JournalEntry.create(data),
    uuidResolver = uuid => globalThis.fromUuid?.(uuid)
  } = {}) {
    this.permissions = permissionService;
    this.toolkit = toolkitAdapter;
    this.settingProvider = settingProvider;
    this.settingWriter = settingWriter;
    this.folderCreator = folderCreator;
    this.journalCreator = journalCreator;
    this.uuidResolver = uuidResolver;
    this.adjustments = new Map();
  }

  configuredFolder() {
    const id = String(this.settingProvider(SETTINGS.RELATIONSHIPS_FOLDER) ?? "").split(".").at(-1);
    const folder = game.folders?.get?.(id);
    return folder?.type === "JournalEntry" ? folder : null;
  }

  findManagedFolder() {
    return collectionValues(game.folders).find(folder =>
      folder.type === "JournalEntry" && flagsFor(folder).kind === RELATIONSHIP_FOLDER_KIND
    ) ?? null;
  }

  async ensureFolder() {
    let folder = this.configuredFolder() ?? this.findManagedFolder();
    if (!folder) {
      folder = await this.folderCreator({
        name: localize("STARFLEET.Relations.Folder", "NPC Relationships"),
        type: "JournalEntry",
        flags: { [MODULE_ID]: { kind: RELATIONSHIP_FOLDER_KIND } }
      });
    }
    if (folder && this.settingProvider(SETTINGS.RELATIONSHIPS_FOLDER) !== folder.id) {
      await this.settingWriter(SETTINGS.RELATIONSHIPS_FOLDER, folder.id);
    }
    return folder;
  }

  findByActorUuid(actorUuid) {
    return collectionValues(game.journal).find(entry => {
      const flags = flagsFor(entry);
      return flags.app === RELATIONSHIP_APP && flags.actorUuid === actorUuid;
    }) ?? null;
  }

  async resolveActor(actorOrUuid) {
    if (typeof actorOrUuid !== "string") return actorOrUuid;
    const directId = actorOrUuid.split(".").at(-1);
    return game.actors?.get?.(directId) ?? await this.uuidResolver(actorOrUuid);
  }

  async addActor(actorOrUuid) {
    if (!game.user?.isGM) throw new Error(localize("STARFLEET.Relations.GMOnly", "Only a GM can add relationships."));
    const actor = await this.resolveActor(actorOrUuid);
    const documentName = actor?.documentName ?? actor?.constructor?.documentName;
    if (!actor || (documentName && documentName !== "Actor") || this.toolkit?.isStarSystemActor?.(actor)) {
      throw new Error(localize("STARFLEET.Relations.ActorRequired", "Drop an NPC Actor here."));
    }
    const existing = this.findByActorUuid(actor.uuid);
    if (existing) return { journal: existing, created: false };
    const folder = await this.ensureFolder();
    const owner = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
    const ownership = { ...(actor.ownership ?? {}), default: owner };
    const title = `${localize("STARFLEET.Relations.JournalTitle", "Relationship")} — ${actor.name}`;
    const journal = await this.journalCreator({
      name: title,
      folder: folder.id,
      ownership,
      flags: {
        [MODULE_ID]: {
          app: RELATIONSHIP_APP,
          actorUuid: actor.uuid,
          actorId: actor.id,
          actorName: actor.name,
          actorImage: actor.img ?? "",
          score: 0,
          history: [],
          terminalPath: `/relations/${actor.id}`
        }
      },
      pages: [{
        name: localize("STARFLEET.Relations.History", "Relationship History"),
        type: "text",
        flags: { [MODULE_ID]: { kind: RELATIONSHIP_PAGE_KIND } },
        text: { format: 1, content: historyHtml(actor.name, []) }
      }]
    });
    return { journal, created: true };
  }

  canAdjust(journal, user = game.user) {
    if (user?.isGM) return true;
    const owner = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
    if (typeof journal?.testUserPermission === "function") return journal.testUserPermission(user, owner, { exact: false });
    const ownership = journal?.ownership ?? {};
    return (ownership[user?.id] ?? ownership.default ?? 0) >= owner;
  }

  async adjust(journalId, delta, reason = "") {
    const current = this.adjustments.get(journalId) ?? Promise.resolve();
    const adjustment = current.then(() => this._adjust(journalId, delta, reason));
    const tracked = adjustment.catch(() => {});
    this.adjustments.set(journalId, tracked);
    try {
      return await adjustment;
    } finally {
      if (this.adjustments.get(journalId) === tracked) this.adjustments.delete(journalId);
    }
  }

  async _adjust(journalId, delta, reason) {
    const journal = game.journal?.get?.(journalId) ?? collectionValues(game.journal).find(entry => entry.id === journalId);
    const flags = flagsFor(journal);
    if (!journal || flags.app !== RELATIONSHIP_APP) throw new Error(localize("STARFLEET.Relations.NotFound", "Relationship record not found."));
    if (!this.canAdjust(journal)) throw new Error(localize("STARFLEET.Relations.NoPermission", "You cannot change this relationship."));
    const step = Number(delta) > 0 ? 1 : -1;
    const previous = Math.max(-20, Math.min(20, Number(flags.score ?? 0)));
    const value = Math.max(-20, Math.min(20, previous + step));
    if (value === previous) return { journal, previous, value, changed: false };

    const history = Array.isArray(flags.history) ? [...flags.history] : [];
    history.push({
      id: randomId(),
      timestamp: new Date().toISOString(),
      userId: game.user?.id ?? "",
      userName: game.user?.name ?? "—",
      delta: step,
      previous,
      value,
      reason: String(reason ?? "").trim() || localize("STARFLEET.Relations.NoReason", "No reason specified")
    });
    await journal.update({
      [`flags.${MODULE_ID}.score`]: value,
      [`flags.${MODULE_ID}.history`]: history
    });

    const actorName = flags.actorName || game.actors?.get?.(flags.actorId)?.name || journal.name;
    let page = collectionValues(journal.pages).find(candidate => flagsFor(candidate).kind === RELATIONSHIP_PAGE_KIND)
      ?? collectionValues(journal.pages)[0];
    const content = historyHtml(actorName, history);
    if (page?.update) await page.update({ "text.content": content });
    else if (journal.createEmbeddedDocuments) {
      [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [{
        name: localize("STARFLEET.Relations.History", "Relationship History"),
        type: "text",
        flags: { [MODULE_ID]: { kind: RELATIONSHIP_PAGE_KIND } },
        text: { format: 1, content }
      }]);
    }
    return { journal, previous, value, changed: true, entry: history.at(-1), page };
  }

  getRelations() {
    return this.permissions.filter(game.journal)
      .filter(entry => flagsFor(entry).app === RELATIONSHIP_APP)
      .map(entry => {
        const flags = flagsFor(entry);
        const actor = game.actors?.get?.(flags.actorId);
        const score = Math.max(-20, Math.min(20, Number(flags.score ?? 0)));
        const history = (Array.isArray(flags.history) ? flags.history : []).map(item => ({
          ...item,
          deltaLabel: item.delta > 0 ? `+${item.delta}` : String(item.delta),
          timestampLabel: new Date(item.timestamp).toLocaleString()
        })).reverse();
        return {
          id: entry.id,
          uuid: entry.uuid,
          appId: APP_IDS.RELATIONS,
          actorId: flags.actorId,
          actorUuid: flags.actorUuid,
          name: actor?.name ?? flags.actorName ?? entry.name,
          image: actor?.img ?? flags.actorImage ?? "",
          score,
          tone: scoreTone(score),
          history,
          canAdjust: this.canAdjust(entry),
          canIncrease: score < 20 && this.canAdjust(entry),
          canDecrease: score > -20 && this.canAdjust(entry)
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
