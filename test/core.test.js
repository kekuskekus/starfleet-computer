import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ComputerAppRegistry } from "../scripts/apps/ComputerAppRegistry.js";
import { PermissionService } from "../scripts/services/PermissionService.js";
import { Sta2eToolkitAdapter } from "../scripts/adapters/Sta2eToolkitAdapter.js";
import { CommunicationService, messageMatchesAudience, normalizeRecipient, normalizeRecipients } from "../scripts/services/CommunicationService.js";

test("manifest keeps STA2e Toolkit optional and supports Foundry 13 through 14", () => {
  const manifest = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));
  assert.equal(manifest.compatibility.minimum, "13");
  assert.equal(manifest.compatibility.maximum, "14");
  assert.equal(manifest.relationships.requires, undefined);
  assert.deepEqual(manifest.relationships.optional, [{ id: "sta2e-toolkit", type: "module" }]);
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
