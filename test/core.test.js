import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ComputerAppRegistry } from "../scripts/apps/ComputerAppRegistry.js";
import { PermissionService } from "../scripts/services/PermissionService.js";
import { Sta2eToolkitAdapter } from "../scripts/adapters/Sta2eToolkitAdapter.js";
import { CommunicationService, messageMatchesAudience, normalizeRecipient, normalizeRecipients } from "../scripts/services/CommunicationService.js";
import { AstrometricsService } from "../scripts/services/AstrometricsService.js";
import { SearchService, plainText, searchTerms } from "../scripts/services/SearchService.js";
import { CommandRegistry } from "../scripts/apps/CommandRegistry.js";
import { registerCommands } from "../scripts/apps/registerCommands.js";

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
