import { MODULE_ID, SETTINGS } from "../constants.js";
import { getSetting } from "../settings.js";

const CREW_JOURNAL_APP = "crew-journal";
const CREW_JOURNAL_FOLDER_KIND = "crew-journals";

function collectionValues(collection) {
  return Array.from(collection?.contents ?? collection?.values?.() ?? collection ?? []);
}

function flagsFor(document) {
  return document?.flags?.[MODULE_ID] ?? {};
}

function slug(value) {
  return String(value ?? "crew").toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
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

export class CrewJournalService {
  constructor({
    dataService,
    permissionService,
    settingProvider = getSetting,
    settingWriter = (key, value) => game.settings.set(MODULE_ID, key, value),
    folderCreator = data => Folder.create(data),
    journalCreator = data => JournalEntry.create(data)
  } = {}) {
    this.data = dataService;
    this.permissions = permissionService;
    this.settingProvider = settingProvider;
    this.settingWriter = settingWriter;
    this.folderCreator = folderCreator;
    this.journalCreator = journalCreator;
    this.syncPromise = null;
  }

  configuredJournalFolder() {
    const id = String(this.settingProvider(SETTINGS.CREW_JOURNALS_FOLDER) ?? "").split(".").at(-1);
    const folder = game.folders?.get?.(id);
    return folder?.type === "JournalEntry" ? folder : null;
  }

  findManagedFolder() {
    return collectionValues(game.folders).find(folder =>
      folder.type === "JournalEntry" && flagsFor(folder).kind === CREW_JOURNAL_FOLDER_KIND
    ) ?? null;
  }

  async ensureJournalFolder() {
    let folder = this.configuredJournalFolder() ?? this.findManagedFolder();
    if (!folder) {
      folder = await this.folderCreator({
        name: localize("STARFLEET.Crew.JournalFolder", "Crew Journals"),
        type: "JournalEntry",
        flags: { [MODULE_ID]: { kind: CREW_JOURNAL_FOLDER_KIND } }
      });
    }
    if (folder && this.settingProvider(SETTINGS.CREW_JOURNALS_FOLDER) !== folder.id) {
      await this.settingWriter(SETTINGS.CREW_JOURNALS_FOLDER, folder.id);
    }
    return folder;
  }

  journalForActor(actor) {
    return collectionValues(game.journal).find(entry => {
      const flags = flagsFor(entry);
      return flags.app === CREW_JOURNAL_APP && flags.actorUuid === actor.uuid;
    }) ?? null;
  }

  async sync() {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this._sync();
    try {
      return await this.syncPromise;
    } finally {
      this.syncPromise = null;
    }
  }

  async _sync() {
    if (!game.user?.isGM) return { created: 0, existing: 0, skipped: true };
    const actors = this.data.getCrewActors({ permitted: false });
    if (!this.data.configuredFolderId(SETTINGS.CREW_FOLDER)) {
      return { created: 0, existing: 0, skipped: true };
    }
    const folder = await this.ensureJournalFolder();
    if (!folder) return { created: 0, existing: 0, skipped: true };

    let created = 0;
    let existing = 0;
    for (const actor of actors) {
      const journal = this.journalForActor(actor);
      if (journal) {
        existing += 1;
        const currentFolderId = journal.folder?.id ?? journal.folder;
        if (currentFolderId !== folder.id) await journal.update({ folder: folder.id });
        continue;
      }
      const title = `${localize("STARFLEET.Crew.Journal", "Crew Journal")} — ${actor.name}`;
      await this.journalCreator({
        name: title,
        folder: folder.id,
        ownership: { ...(actor.ownership ?? {}) },
        flags: {
          [MODULE_ID]: {
            app: CREW_JOURNAL_APP,
            actorUuid: actor.uuid,
            actorId: actor.id,
            category: "personnel",
            terminalPath: `/crew/${slug(actor.name)}/journal`
          }
        },
        pages: [{
          name: localize("STARFLEET.Crew.Journal", "Crew Journal"),
          type: "text",
          text: {
            format: 1,
            content: `<h1>${escapeHtml(actor.name)}</h1><p>${escapeHtml(localize("STARFLEET.Crew.JournalPlaceholder", "Personnel log ready for updates."))}</p>`
          }
        }]
      });
      created += 1;
    }
    return { created, existing, skipped: false, folderId: folder.id };
  }

  async configureCrewFolder(folderId) {
    if (!game.user?.isGM) throw new Error(localize("STARFLEET.Crew.GMOnly", "Only a GM can configure the crew folder."));
    const normalized = String(folderId ?? "").trim();
    const folder = normalized ? game.folders?.get?.(normalized) : null;
    if (normalized && folder?.type !== "Actor") {
      throw new Error(localize("STARFLEET.Crew.InvalidFolder", "Select a valid Actor folder."));
    }
    await this.settingWriter(SETTINGS.CREW_FOLDER, normalized);
    return this.sync();
  }

  async getJournals() {
    const actorByUuid = new Map(this.data.getCrewActors().map(actor => [actor.uuid, actor]));
    const entries = this.permissions.filter(game.journal).filter(entry => {
      const flags = flagsFor(entry);
      return flags.app === CREW_JOURNAL_APP && actorByUuid.has(flags.actorUuid);
    });
    const records = await Promise.all(entries.map(async entry => {
      const flags = flagsFor(entry);
      const actor = actorByUuid.get(flags.actorUuid);
      const record = await this.data.journalRecord(entry, CREW_JOURNAL_APP);
      return { ...record, actorId: actor.id, actorUuid: actor.uuid, actorName: actor.name, actorImage: actor.img };
    }));
    return records.sort((a, b) => a.actorName.localeCompare(b.actorName));
  }
}

export { CREW_JOURNAL_APP, CREW_JOURNAL_FOLDER_KIND };
