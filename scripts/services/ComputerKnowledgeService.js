import { MODULE_ID, SETTINGS } from "../constants.js";
import { KB_LIMITS, PAGE_UUID } from "./computerKnowledgeProtocol.js";
import { plainText } from "./SearchService.js";

const values = collection => Array.from(collection?.contents ?? collection?.values?.() ?? collection ?? []);

export function journalText(html) {
  const text = String(html ?? "").replace(/<\/(?:p|div|li|h[1-6]|tr)>|<br\s*\/?>/gi, "$&\n");
  if (!globalThis.DOMParser) return plainText(text);
  const doc = new DOMParser().parseFromString(text, "text/html");
  doc.querySelectorAll("script, style, template").forEach(element => element.remove());
  return (doc.body.textContent ?? "").replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
}

export class ComputerKnowledgeService {
  constructor({ dataService, gameProvider = () => game } = {}) {
    this.data = dataService;
    this.game = gameProvider;
    this.lastRefresh = null;
    this.discoveryWrite = Promise.resolve();
  }

  requireGM() { if (!this.game().user?.isGM) throw new Error("GM only"); }
  folder() {
    const id = String(this.game().settings.get(MODULE_ID, SETTINGS.COMPUTER_KNOWLEDGE_FOLDER) || "").split(".").at(-1);
    return values(this.game().folders).find(folder => folder.id === id && folder.type === "JournalEntry") ?? null;
  }

  folderOptions() {
    this.requireGM();
    const folders = values(this.game().folders).filter(folder => folder.type === "JournalEntry");
    const byId = new Map(folders.map(folder => [folder.id, folder]));
    return folders.map(folder => {
      const names = [folder.name], seen = new Set([folder.id]);
      let parent = folder.folder?.id ?? folder.parent?.id ?? folder.folder;
      while (byId.has(parent) && !seen.has(parent)) {
        seen.add(parent);
        const item = byId.get(parent);
        names.unshift(item.name);
        parent = item.folder?.id ?? item.parent?.id ?? item.folder;
      }
      return { value: folder.id, label: names.join(" / "), selected: folder.id === this.folder()?.id };
    }).sort((a, b) => a.label.localeCompare(b.label));
  }

  async configure(id) {
    this.requireGM();
    if (id && !this.folderOptions().some(option => option.value === id)) throw new Error("Invalid Journal folder");
    await this.game().settings.set(MODULE_ID, SETTINGS.COMPUTER_KNOWLEDGE_FOLDER, id);
  }

  buildCorpus() {
    this.requireGM();
    const root = this.folder();
    if (!root) return [];
    const folders = this.data.folderIds(root.id, "JournalEntry");
    const pages = [];
    let size = 0;
    for (const entry of values(this.game().journal)) {
      if (!folders.has(entry.folder?.id ?? entry.folder)) continue;
      for (const page of values(entry.pages)) {
        if (page.type && page.type !== "text") continue;
        if (!PAGE_UUID.test(page.uuid)) continue;
        const text = journalText(page.text?.content);
        if (!text) continue;
        const record = { journalUuid: entry.uuid, journalTitle: String(entry.name ?? ""),
          pageUuid: page.uuid, pageTitle: String(page.name ?? ""), text };
        size += JSON.stringify(record).length;
        if (text.length > KB_LIMITS.page || size > KB_LIMITS.corpus || pages.length >= KB_LIMITS.pages) {
          throw new Error("Knowledge corpus exceeds prototype limits");
        }
        pages.push(record);
      }
    }
    this.lastRefresh = new Date().toISOString();
    return pages;
  }

  debug() {
    this.requireGM();
    const corpus = this.buildCorpus();
    const revealed = this.discoveryJournal()?.getFlag?.(MODULE_ID, "computerRevealedSources") ?? [];
    return { folderOptions: this.folderOptions(), journals: new Set(corpus.map(page => page.journalUuid)).size,
      pages: corpus.length, lastRefresh: this.lastRefresh, revealed: Array.isArray(revealed) ? revealed : [] };
  }

  discoveryJournal() {
    const id = this.game().settings.get(MODULE_ID, SETTINGS.COMPUTER_DISCOVERY_JOURNAL);
    const journal = this.game().journal?.get?.(id);
    if (!journal || values(this.game().users).some(user => !user.isGM && journal.testUserPermission(user, "LIMITED"))) return null;
    return journal;
  }

  recordSources(sources, corpus) {
    this.requireGM();
    const allowed = new Map(corpus.map(page => [page.pageUuid, page]));
    this.discoveryWrite = this.discoveryWrite.catch(() => {}).then(async () => {
      if (!sources.length) return;
      let journal = this.discoveryJournal();
      if (!journal) {
        journal = await JournalEntry.create({ name: "Computer — discovery debug", ownership: { default: 0 },
          pages: [], flags: { [MODULE_ID]: { computerDebug: true } } });
        await this.game().settings.set(MODULE_ID, SETTINGS.COMPUTER_DISCOVERY_JOURNAL, journal.id);
      }
      const previous = journal.getFlag(MODULE_ID, "computerRevealedSources") ?? [];
      const used = new Map((Array.isArray(previous) ? previous : []).map(item => [item.uuid, item]));
      for (const uuid of sources) {
        const page = allowed.get(uuid);
        if (page) used.set(uuid, { uuid, title: `${page.journalTitle} / ${page.pageTitle}`, at: new Date().toISOString() });
      }
      await journal.setFlag(MODULE_ID, "computerRevealedSources", [...used.values()].slice(-500));
    });
    return this.discoveryWrite;
  }

  async resetSources() {
    this.requireGM();
    await this.discoveryWrite.catch(() => {});
    await this.discoveryJournal()?.unsetFlag(MODULE_ID, "computerRevealedSources");
  }
}
