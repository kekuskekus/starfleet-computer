import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ComputerAppRegistry } from "../scripts/apps/ComputerAppRegistry.js";
import { PermissionService } from "../scripts/services/PermissionService.js";
import { Sta2eToolkitAdapter } from "../scripts/adapters/Sta2eToolkitAdapter.js";
import { CommunicationService, messageMatchesAudience, normalizeRecipient, normalizeRecipients } from "../scripts/services/CommunicationService.js";
import { AstrometricsService } from "../scripts/services/AstrometricsService.js";
import { SearchService, normalizeSearchText, plainText, searchTerms } from "../scripts/services/SearchService.js";
import { CommandRegistry } from "../scripts/apps/CommandRegistry.js";
import { registerCommands } from "../scripts/apps/registerCommands.js";
import { ComputerDataService } from "../scripts/services/ComputerDataService.js";
import { CrewJournalService } from "../scripts/services/CrewJournalService.js";
import { RelationshipService } from "../scripts/services/RelationshipService.js";
import { SETTINGS } from "../scripts/constants.js";

test("manifest keeps STA2e Toolkit optional and supports Foundry 13 through 14", () => {
  const manifest = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));
  assert.equal(manifest.compatibility.minimum, "13");
  assert.equal(manifest.compatibility.maximum, "14");
  assert.equal(manifest.relationships.requires, undefined);
  assert.deepEqual(manifest.relationships.optional, [{ id: "sta2e-toolkit", type: "module" }]);
});

test("launcher loads independently before the Computer application API", () => {
  const manifest = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));
  assert.equal(manifest.esmodules[0], "scripts/launcher.js");
  const launcher = readFileSync(new URL("../scripts/launcher.js", import.meta.url), "utf8");
  assert.match(launcher, /doc\.body\.append\(button\)/);
  assert.match(launcher, /visible|mountLauncher/);
  const source = readFileSync(new URL("../scripts/main.js", import.meta.url), "utf8");
  assert.equal(source.includes('import { StarfleetComputerApp }'), false);
  assert.match(source, /await import\("\.\/apps\/StarfleetComputerApp\.js"\)/);
});

test("registry orders built-in ids and rejects duplicates", () => {
  const registry = new ComputerAppRegistry();
  registry.register({ id: "crew", label: "Crew" });
  registry.register({ id: "home", label: "Home" });
  assert.deepEqual(registry.list().map(app => app.id), ["home", "crew"]);
  assert.throws(() => registry.register({ id: "home", label: "Again" }), /already registered/);
});

test("permissions honor GM access and observer ownership", () => {
  const service = new PermissionService(() => ({ id: "player", isGM: false }));
  assert.equal(service.canView({ ownership: { player: 2 } }), true);
  assert.equal(service.canView({ ownership: { default: 0 } }), false);
  assert.equal(service.canView({ ownership: {}, testUserPermission: () => true }), true);
  assert.equal(service.canView({ ownership: {} }, { id: "gm", isGM: true }), true);
});

test("Crew contains only permitted Actors in the configured folder tree", () => {
  const previousGame = globalThis.game;
  const root = { id: "crew-root", name: "Crew", type: "Actor", folder: null };
  const child = { id: "bridge", name: "Bridge", type: "Actor", folder: { id: root.id } };
  const actor = (id, folder) => ({ id, uuid: `Actor.${id}`, name: id, folder, img: `${id}.webp`, system: {} });
  globalThis.game = {
    folders: [root, child, { id: "other", name: "Other", type: "Actor", folder: null }],
    actors: [actor("captain", child), actor("engineer", root), actor("visitor", { id: "other" })]
  };
  try {
    const service = new ComputerDataService({
      permissionService: { filter: documents => Array.from(documents ?? []) },
      toolkitAdapter: { isStarSystemActor: () => false },
      settingProvider: key => key === SETTINGS.CREW_FOLDER ? root.id : ""
    });
    assert.deepEqual(service.getCrew().map(entry => entry.id), ["captain", "engineer"]);
    assert.equal(service.isCrewActor(globalThis.game.actors[2]), false);
  } finally {
    globalThis.game = previousGame;
  }
});

test("Crew journal synchronization creates stable Foundry records without replacing them", async () => {
  const previousGame = globalThis.game;
  const settings = new Map([[SETTINGS.CREW_FOLDER, "crew-root"], [SETTINGS.CREW_JOURNALS_FOLDER, ""]]);
  const actors = [
    { id: "a1", uuid: "Actor.a1", name: "Asha", ownership: { default: 0, u1: 2 } },
    { id: "a2", uuid: "Actor.a2", name: "T'Len", ownership: { default: 0, u2: 2 } }
  ];
  globalThis.game = { user: { isGM: true }, folders: [], journal: [] };
  try {
    const service = new CrewJournalService({
      dataService: {
        configuredFolderId: key => settings.get(key),
        getCrewActors: () => actors
      },
      permissionService: { filter: documents => Array.from(documents ?? []) },
      settingProvider: key => settings.get(key),
      settingWriter: async (key, value) => settings.set(key, value),
      folderCreator: async data => {
        const folder = { id: "crew-journals", ...data };
        globalThis.game.folders.push(folder);
        return folder;
      },
      journalCreator: async data => {
        const journal = { id: `j${globalThis.game.journal.length + 1}`, uuid: `JournalEntry.j${globalThis.game.journal.length + 1}`, ...data };
        globalThis.game.journal.push(journal);
        return journal;
      }
    });
    assert.deepEqual(await service.sync(), { created: 2, existing: 0, skipped: false, folderId: "crew-journals" });
    assert.equal(globalThis.game.journal.length, 2);
    assert.equal(globalThis.game.journal[0].flags["starfleet-computer"].actorUuid, "Actor.a1");
    globalThis.game.journal[0].pages[0].text.content = "MCP content";
    const second = await service.sync();
    assert.equal(second.created, 0);
    assert.equal(second.existing, 2);
    assert.equal(globalThis.game.journal[0].pages[0].text.content, "MCP content");
  } finally {
    globalThis.game = previousGame;
  }
});

test("NPC relationships create one Journal, persist reasons and clamp scores", async () => {
  const previousGame = globalThis.game;
  const previousConst = globalThis.CONST;
  const settings = new Map([[SETTINGS.RELATIONSHIPS_FOLDER, ""]]);
  const folders = new Map();
  const journals = new Map();
  const actor = {
    id: "npc1", uuid: "Actor.npc1", documentName: "Actor", name: "Commander Vek",
    img: "vek.webp", ownership: { default: 0 }
  };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
  globalThis.game = {
    user: { id: "gm", name: "Адмирал", isGM: true },
    actors: new Map([[actor.id, actor]]),
    folders,
    journal: journals,
    i18n: { localize: key => key }
  };
  try {
    const service = new RelationshipService({
      permissionService: { filter: documents => Array.from(documents?.values?.() ?? documents ?? []) },
      toolkitAdapter: { isStarSystemActor: () => false },
      settingProvider: key => settings.get(key),
      settingWriter: async (key, value) => settings.set(key, value),
      folderCreator: async data => {
        const folder = { id: "relationships", ...data };
        folders.set(folder.id, folder);
        return folder;
      },
      journalCreator: async data => {
        const pageData = data.pages[0];
        const page = {
          id: "page1", ...pageData,
          async update(changes) { this.text.content = changes["text.content"]; }
        };
        const journal = {
          id: "relation1", uuid: "JournalEntry.relation1", ...data, pages: [page],
          testUserPermission: () => true,
          async update(changes) {
            this.flags["starfleet-computer"].score = changes["flags.starfleet-computer.score"];
            this.flags["starfleet-computer"].history = changes["flags.starfleet-computer.history"];
          }
        };
        journals.set(journal.id, journal);
        return journal;
      }
    });

    const first = await service.addActor(actor.uuid);
    assert.equal(first.created, true);
    assert.equal((await service.addActor(actor.uuid)).created, false);
    assert.equal(journals.size, 1);
    assert.equal(first.journal.ownership.default, 3);

    const change = await service.adjust(first.journal.id, 1, "Помог <экипажу>");
    assert.equal(change.value, 1);
    assert.equal(change.entry.reason, "Помог <экипажу>");
    assert.match(first.journal.pages[0].text.content, /Помог &lt;экипажу&gt;/);
    assert.equal(service.getRelations()[0].score, 1);

    first.journal.flags["starfleet-computer"].score = 20;
    assert.equal((await service.adjust(first.journal.id, 1, "beyond limit")).changed, false);
    assert.equal(first.journal.flags["starfleet-computer"].history.length, 1);

    const search = new SearchService({
      dataService: { configuredFolderId: () => "", folderIds: () => new Set(), isCrewActor: () => false },
      permissionService: { filter: documents => Array.from(documents?.values?.() ?? documents ?? []) },
      toolkitAdapter: { isStarSystemActor: () => false }
    });
    const results = await search.search("помог экипажу");
    assert.equal(results[0].appId, "relations");
    assert.equal(results[0].type, "relationship");
  } finally {
    globalThis.game = previousGame;
    globalThis.CONST = previousConst;
  }
});

test("toolkit adapter discovers systems and separates system and planet scenes", () => {
  const actor = {
    id: "a1", uuid: "Actor.a1", name: "Talvos", img: "talvos.webp",
    getFlag: (_scope, key) => key === "starSystem" ? { isStarSystem: true, designation: "Talvos", sector: "Golba" } : null
  };
  const systemScene = { id: "s1", getFlag: (_scope, key) => key === "starSystemSceneActor" ? "a1" : null };
  const planetScene = { id: "s2", getFlag: (_scope, key) => key === "starSystemSceneActor" ? "a1" : key === "starSystemSceneWorld" ? "w1" : null };
  const fakeGame = {
    modules: new Map([["sta2e-toolkit", { active: true }]]),
    sta2eToolkit: { getActiveCampaign: () => ({ stardate: 49523.7 }) },
    actors: new Map([["a1", actor]]),
    scenes: [systemScene, planetScene]
  };
  const adapter = new Sta2eToolkitAdapter({ gameProvider: () => fakeGame });
  assert.equal(adapter.isAvailable(), true);
  assert.equal(adapter.getStarSystems()[0].designation, "Talvos");
  assert.equal(adapter.getMainSystemScene(actor).id, "s1");
  assert.deepEqual(adapter.getPlanetScenes(actor).map(scene => scene.id), ["s2"]);
  assert.equal(adapter.getStardate(), "49523.7");
});

test("communication recipients normalize and enforce private audiences", () => {
  assert.deepEqual(normalizeRecipient("user:u1"), { type: "user", id: "u1", label: "u1" });
  assert.deepEqual(normalizeRecipients({ recipient: "everyone" })[0].type, "everyone");
  const audience = {
    userIds: new Set(["u1"]),
    actorIds: new Set(["a1", "Actor.a1"]),
    groups: new Set(["bridge"])
  };
  assert.equal(messageMatchesAudience(normalizeRecipients({ recipient: "user:u1" }), audience), true);
  assert.equal(messageMatchesAudience(normalizeRecipients({ recipient: "actor:a2" }), audience), false);
  assert.equal(messageMatchesAudience(normalizeRecipients({ recipient: "group:bridge" }), audience), true);
  assert.equal(messageMatchesAudience(normalizeRecipients({ recipient: "group:engineering" }), audience), false);
});

test("actor-addressed communications grant Journal visibility only to its owners and GMs", () => {
  const previousGame = globalThis.game;
  const gm = { id: "gm", isGM: true };
  const owner = { id: "u1", isGM: false };
  const other = { id: "u2", isGM: false };
  const actor = {
    id: "a1",
    testUserPermission(user) { return user.id === "u1"; }
  };
  globalThis.game = { actors: new Map([["a1", actor]]), users: [gm, owner, other] };
  try {
    const service = new CommunicationService();
    assert.deepEqual(service.ownershipFor({ type: "actor", id: "a1" }), { default: 0, gm: 2, u1: 2 });
  } finally {
    globalThis.game = previousGame;
  }
});

test("Astrometrics filters Toolkit systems and exposes existing system and planet Scenes", () => {
  const systemScene = { id: "scene-system", uuid: "Scene.system", name: "Talvos System" };
  const planetScene = {
    id: "scene-world", uuid: "Scene.world", name: "Talvos Prime", getFlag: (_scope, key) => key === "starSystemSceneWorld" ? "w1" : null
  };
  const systems = [
    { actorId: "a1", uuid: "Actor.a1", designation: "Talvos", sector: "Golba", region: "Outer", affiliation: "Federation", travelCode: "Green", worlds: [{ id: "w1", name: "Talvos Prime" }] },
    { actorId: "a2", uuid: "Actor.a2", designation: "Korvan", sector: "Golba", region: "Core", affiliation: "Independent", travelCode: "Amber", worlds: [] }
  ];
  const toolkit = {
    getStarSystems: () => systems,
    getMainSystemScene: id => id === "a1" ? systemScene : null,
    getPlanetScenes: id => id === "a1" ? [planetScene] : [],
    getSceneWorldId: scene => scene.getFlag("sta2e-toolkit", "starSystemSceneWorld")
  };
  const service = new AstrometricsService({ toolkitAdapter: toolkit, permissionService: {} });
  assert.deepEqual(service.getBrowser({ filters: { region: "Outer" } }).systems.map(system => system.designation), ["Talvos"]);
  assert.deepEqual(service.getBrowser({ filters: { query: "Prime" } }).systems.map(system => system.designation), ["Talvos"]);
  const selected = service.getBrowser({ selectedId: "a1" }).selected;
  assert.equal(selected.systemScene.uuid, "Scene.system");
  assert.equal(selected.planetScenes[0].worldName, "Talvos Prime");
});

test("terminal commands support natural search, map aliases and exact paths", async () => {
  assert.deepEqual(searchTerms("What do we know about the Talvos anomaly?"), ["talvos", "anomaly"]);
  assert.equal(plainText("<p>Temporal <strong>anomaly</strong></p>"), "Temporal anomaly");
  const talvos = { id: "a1", actorId: "a1", type: "star-system", title: "Talvos", path: "/astrometrics/golba/talvos" };
  const search = {
    search: async (_query, options = {}) => options.types?.includes("star-system") ? [talvos] : [talvos],
    resolvePath: async path => path === talvos.path ? talvos : null
  };
  const registry = new CommandRegistry();
  registerCommands(registry);
  const natural = await registry.execute("What do we know about Talvos?", { search });
  assert.equal(natural.results[0].title, "Talvos");
  const map = await registry.execute("map Talvos", { search });
  assert.equal(map.autoOpen.actorId, "a1");
  const open = await registry.execute(`open ${talvos.path}`, { search });
  assert.equal(open.autoOpen.path, talvos.path);
});

test("Russian commands cover navigation and pass Cyrillic queries to search", async () => {
  const registry = new CommandRegistry();
  registerCommands(registry);
  for (const [alias, id] of [
    ["помощь", "help"], ["главная", "home"], ["очистить", "clear"], ["поиск", "search"],
    ["открыть", "open"], ["журналы", "logs"], ["база", "database"], ["экипаж", "crew"], ["отношения", "relations"],
    ["файлы", "files"], ["связь", "comms"], ["астрометрика", "astrometrics"], ["карта", "system"]
  ]) assert.equal(registry.get(alias)?.id, id);

  let received = "";
  const result = await registry.execute("поиск временной аномалии", {
    search: { search: async query => { received = query; return []; } }
  });
  assert.equal(received, "временной аномалии");
  assert.deepEqual(result.results, []);
  assert.equal((await registry.execute("файлы", { search: {} })).navigate, "files");
});

test("search normalizes Cyrillic, Russian inflections, yo/e and Journal page names", async () => {
  const previousGame = globalThis.game;
  const entry = {
    id: "ru1", uuid: "JournalEntry.ru1", name: "Исследования Талвоса", folder: { id: "database" }, flags: {},
    pages: [{ name: "Звёздные явления", text: { content: "<p>Обнаружена временная аномалия.</p>" } }]
  };
  globalThis.game = { journal: [entry], actors: [] };
  try {
    const service = new SearchService({
      dataService: {
        configuredFolderId: key => key === SETTINGS.DATABASE_FOLDER ? "database" : "",
        folderIds: id => new Set(id ? [id] : []),
        isCrewActor: () => false
      },
      permissionService: { filter: documents => Array.from(documents ?? []) },
      toolkitAdapter: { isStarSystemActor: () => false }
    });
    assert.equal(normalizeSearchText("ЗВЁЗДНЫЙ"), "звездный");
    assert.deepEqual(searchTerms("Что известно о звёздной аномалии?"), ["звездной", "аномалии"]);
    assert.equal((await service.search("звездные явления")).length, 1);
    assert.equal((await service.search("временной аномалии")).length, 1);
    assert.equal((await service.search("Талвосе")).length, 1);
  } finally {
    globalThis.game = previousGame;
  }
});

test("local search excludes communications not addressed to the current user", async () => {
  const previousGame = globalThis.game;
  const message = (id, name, content) => ({
    id, uuid: `JournalEntry.${id}`, name, folder: { id: "comms" },
    flags: { "starfleet-computer": { app: "comms", recipient: `user:${id}` } },
    pages: [{ text: { content } }]
  });
  const allowed = message("allowed", "Allowed transmission", "Talvos rendezvous");
  const privateMessage = message("private", "Secret transmission", "Omega directive");
  globalThis.game = { journal: [allowed, privateMessage], actors: [] };
  try {
    const service = new SearchService({
      dataService: { configuredFolderId: () => "comms", folderIds: () => new Set(["comms"]) },
      permissionService: { filter: documents => Array.from(documents ?? []) },
      toolkitAdapter: { isStarSystemActor: () => false },
      communicationService: { isAddressedTo: entry => entry.id === "allowed" }
    });
    assert.equal((await service.search("Talvos")).length, 1);
    assert.equal((await service.search("Omega")).length, 0);
  } finally {
    globalThis.game = previousGame;
  }
});
