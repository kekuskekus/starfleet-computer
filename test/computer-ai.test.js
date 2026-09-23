import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, webcrypto } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { KnowledgeSessionStore } from "../bridge/knowledge-session-store.js";
import { createBridge } from "../bridge/server.js";
import { codexArguments, runCodex } from "../bridge/codex-runner.js";
import { CommandRegistry } from "../scripts/apps/CommandRegistry.js";
import { registerCommands } from "../scripts/apps/registerCommands.js";
import { ComputerKnowledgeService } from "../scripts/services/ComputerKnowledgeService.js";
import { ComputerDataService } from "../scripts/services/ComputerDataService.js";
import { ComputerSocketService, chooseGm, isComputerSessionUpdate } from "../scripts/services/ComputerSocketService.js";
import { ComputerAiClient } from "../scripts/services/ComputerAiClient.js";
import { KB_LIMITS, recentContext, localBridgeUrl } from "../scripts/services/computerKnowledgeProtocol.js";
import { MODULE_ID, SETTINGS } from "../scripts/constants.js";

const page = (name, text = "Орбитальные наблюдения: примерно один год.") => ({ journalUuid: "JournalEntry.Tavos", journalTitle: "Tavos",
  pageUuid: `JournalEntry.Tavos.JournalEntryPage.${name}`, pageTitle: name, text });
const payload = () => ({ requestId: randomUUID(), question: "Сравни орбитальные наблюдения", knowledge: [page("Orbit"), page("Secret", "Secret unconnected fact")] });

test("commands retain local routing, optional unknown handler and explicit ask alias", async () => {
  const registry = new CommandRegistry(); registerCommands(registry);
  const local = [], ai = [];
  const context = { search: { search: async query => { local.push(query); return []; } },
    ask: async query => { ai.push(query); return { lines: ["answer"] }; } };
  await registry.execute("Что произошло?", context);
  assert.deepEqual(local, ["Что произошло?"]);
  context.onUnknown = context.ask;
  await registry.execute("Что произошло?", context);
  await registry.execute("search колония", context);
  await registry.execute("поиск экипаж", context);
  await registry.execute("спроси про орбиту", context);
  await registry.execute("help", context);
  registry.register({ id: "custom", aliases: ["особая"], execute: async () => ({ lines: ["local"] }) });
  assert.deepEqual(await registry.execute("особая", context), { lines: ["local"] });
  assert.deepEqual(ai, ["Что произошло?", "про орбиту"]);
  assert.deepEqual(local, ["Что произошло?", "колония", "экипаж"]);
});

test("knowledge extraction includes only text pages in configured descendants and is GM-only", async () => {
  const previous = globalThis.game;
  const folders = [{ id: "root", name: "Campaign", type: "JournalEntry" },
    { id: "child", name: "Knowledge", type: "JournalEntry", folder: { id: "root" } },
    { id: "outside", name: "Elsewhere", type: "JournalEntry" }, { id: "actors", type: "Actor" }];
  const journal = (id, folder) => ({ uuid: `JournalEntry.${id}`, name: id, folder: { id: folder }, pages: [
    { uuid: `JournalEntry.${id}.JournalEntryPage.Text`, name: "Text", type: "text", text: { content: "<p>Colony</p><script>bad()</script><p>Records</p>" } },
    { uuid: `JournalEntry.${id}.JournalEntryPage.Image`, type: "image", text: { content: "not lore" } }
  ] });
  const settings = new Map([[SETTINGS.COMPUTER_KNOWLEDGE_FOLDER, "Folder.root"]]);
  globalThis.game = { user: { isGM: true }, folders, journal: [journal("A", "root"), journal("B", "child"), journal("C", "outside")],
    settings: { get: (_m, key) => settings.get(key), set: async (_m, key, value) => settings.set(key, value) } };
  try {
    const service = new ComputerKnowledgeService({ dataService: new ComputerDataService() });
    assert.deepEqual(service.buildCorpus().map(item => item.journalUuid), ["JournalEntry.A", "JournalEntry.B"]);
    assert.ok(!service.buildCorpus()[0].text.includes("bad()"));
    assert.equal(service.folderOptions().find(item => item.value === "child").label, "Campaign / Knowledge");
    await assert.rejects(service.configure("actors"), /Invalid Journal/);
    settings.set(SETTINGS.COMPUTER_KNOWLEDGE_FOLDER, "missing");
    assert.deepEqual(service.buildCorpus(), []);
    game.user.isGM = false;
    assert.throws(() => service.buildCorpus(), /GM only/);
    await assert.rejects(service.configure("root"), /GM only/);
  } finally { globalThis.game = previous; }
});

test("MCP sessions reject cross-request access, arbitrary UUIDs, unread sources, and enforce expiry", () => {
  let now = 1000;
  const store = new KnowledgeSessionStore({ now: () => now, ttl: 100 });
  const data = payload(); const { token } = store.create(data);
  assert.throws(() => store.get(token, randomUUID()), /Wrong request/);
  assert.throws(() => store.read(token, { requestId: data.requestId, pageUuid: "Actor.A" }), /Page unavailable/);
  assert.throws(() => store.read(token, { requestId: data.requestId, pageUuid: page("Secret").pageUuid }), /search first/);
  const results = store.search(token, { requestId: data.requestId, query: "орбитальные" });
  assert.equal(results.results.length, 1);
  assert.equal(store.read(token, { requestId: data.requestId, pageUuid: page("Orbit").pageUuid }).text, page("Orbit").text);
  assert.deepEqual(store.validateResult(token, { answer: "Record", sources: [page("Orbit").pageUuid, page("Secret").pageUuid, "Actor.A"] }).sources, [page("Orbit").pageUuid]);
  now += 101;
  assert.throws(() => store.get(token), /Session unavailable/);
  assert.equal(store.sessions.size, 0);
  assert.throws(() => store.create({ ...data, requestId: "../file" }), /Invalid request/);
});

test("retrieval budgets bound broad searches and repeated reads", () => {
  const store = new KnowledgeSessionStore(); const data = payload(); const { token } = store.create(data);
  for (let n = 0; n < KB_LIMITS.searches; n++) store.search(token, { requestId: data.requestId, query: "орбитальные", limit: 1000 });
  assert.throws(() => store.search(token, { requestId: data.requestId, query: "Secret" }), /budget/);
  for (let n = 0; n < KB_LIMITS.reads; n++) store.read(token, { requestId: data.requestId, pageUuid: page("Orbit").pageUuid });
  assert.throws(() => store.read(token, { requestId: data.requestId, pageUuid: page("Orbit").pageUuid }), /budget/);
});

test("recent context excludes local commands and errors and respects exchange and size limits", () => {
  const history = Array.from({ length: 30 }, (_, n) => ({ kind: "ai", input: `q${n}`, lines: ["a".repeat(6000)] }));
  history.push({ input: "search secret", lines: ["local"], kind: "local" }, { kind: "ai", input: "bad", lines: ["error"], error: true });
  const result = recentContext(history);
  assert.ok(result.length <= KB_LIMITS.history);
  assert.ok(result.every(item => item.question.startsWith("q")));
  assert.ok(result.reduce((n, item) => n + item.question.length + item.answer.length, 0) <= KB_LIMITS.context);
});

test("bridge URL accepts only loopback origins", () => {
  assert.equal(localBridgeUrl("http://127.0.0.1:32123"), "http://127.0.0.1:32123");
  for (const value of ["https://example.com", "http://user:pass@localhost", "http://localhost/extra", "file:///C:/secret"]) assert.throws(() => localBridgeUrl(value));
});

test("runner passes hostile input through stdin, has no shell, and isolates user integrations", async () => {
  const question = '$(whoami); `echo bad`; " & del *'; let captured;
  const spawnProcess = (executable, args, options) => {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let input = ""; child.stdin.on("data", chunk => { input += chunk; });
    child.stdin.on("finish", () => {
      captured = { executable, args, options, input };
      child.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify({ answer: "OK", sources: [] }) } }) + "\n");
      child.emit("close", 0);
    });
    return child;
  };
  assert.equal((await runCodex({ requestId: randomUUID(), question, token: "test", mcpUrl: "http://127.0.0.1:1/mcp", spawnProcess })).answer, "OK");
  assert.equal(captured.options.shell, false);
  assert.ok(!captured.args.some(arg => arg.includes(question)));
  assert.equal(JSON.parse(captured.input).playerQuestion, question);
  assert.ok(captured.args.includes("features.shell_tool=false"));
  assert.ok(captured.args.includes("--ignore-user-config"));
  assert.ok(codexArguments({ cwd: "empty", mcpUrl: "http://127.0.0.1/mcp" }).includes("--ephemeral"));
});

async function bridgeFixture(t, options = {}) {
  const bridge = createBridge({ origins: ["https://foundry.example"], logger: { error() {} }, health: async () => ({ installed: true, authenticated: true }), ...options });
  await new Promise(resolve => bridge.server.listen(0, "127.0.0.1", resolve));
  t.after(() => { bridge.server.close(); bridge.server.closeAllConnections(); });
  const url = `http://127.0.0.1:${bridge.server.address().port}`;
  const headers = { Authorization: `Bearer ${bridge.pairingToken}`, "Content-Type": "application/json" };
  return { ...bridge, url, headers };
}

test("bridge supports real MCP discovery/retrieval, validates sources, and deletes corpus", async t => {
  let names;
  const bridge = await bridgeFixture(t, { runner: async ({ requestId, token, mcpUrl }) => {
    const client = new Client({ name: "test-client", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    try {
      names = (await client.listTools()).tools.map(tool => tool.name);
      const result = await client.callTool({ name: "computer_search_knowledge", arguments: { requestId, query: "орбитальные" } });
      const data = JSON.parse(result.content[0].text);
      assert.equal(data.results.length, 1);
      const denied = await client.callTool({ name: "computer_get_knowledge_page", arguments: { requestId, pageUuid: "JournalEntry.Other.JournalEntryPage.Secret" } });
      assert.equal(denied.isError, true);
      return { answer: "Один год.", sources: [data.results[0].id, "JournalEntry.Other.JournalEntryPage.Secret"] };
    } finally { await client.close(); }
  } });
  const response = await fetch(`${bridge.url}/computer/query`, { method: "POST", headers: bridge.headers, body: JSON.stringify(payload()) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).sources, [page("Orbit").pageUuid]);
  assert.equal(names.length, 5);
  assert.equal(bridge.store.sessions.size, 0);
});

test("bridge rejects unauthenticated clients, untrusted origins and host rebinding", async t => {
  const bridge = await bridgeFixture(t);
  assert.equal((await fetch(`${bridge.url}/health`)).status, 401);
  assert.equal((await fetch(`${bridge.url}/health`, { headers: { ...bridge.headers, Origin: "https://evil.example" } })).status, 403);
  const rejectedHost = await new Promise((resolve, reject) => {
    const request = httpRequest(`${bridge.url}/health`, { headers: { ...bridge.headers, Host: "evil.example:32123" } }, response => {
      response.resume(); resolve(response.statusCode);
    });
    request.on("error", reject); request.end();
  });
  assert.equal(rejectedHost, 403);
  const good = await fetch(`${bridge.url}/health`, { headers: { ...bridge.headers, Origin: "https://foundry.example" } });
  assert.equal(good.status, 200);
  assert.equal(good.headers.get("access-control-allow-origin"), "https://foundry.example");
  assert.equal((await fetch(`${bridge.url}/mcp`, { method: "POST", headers: bridge.headers, body: "{}" })).status, 401);
});

test("bridge cleans sessions after runner errors and rejects concurrent execution", async t => {
  let release, started;
  const running = new Promise(resolve => { started = resolve; });
  const bridge = await bridgeFixture(t, { runner: async () => { started(); await new Promise(resolve => { release = resolve; }); throw new Error("Synthetic failure"); } });
  const first = fetch(`${bridge.url}/computer/query`, { method: "POST", headers: bridge.headers, body: JSON.stringify(payload()) });
  await running;
  assert.equal((await fetch(`${bridge.url}/computer/query`, { method: "POST", headers: bridge.headers, body: JSON.stringify(payload()) })).status, 429);
  release(); assert.equal((await first).status, 400);
  assert.equal(bridge.store.sessions.size, 0);
});

function socketFixture() {
  const listeners = []; const traffic = [];
  const makeUser = (id, isGM) => ({ id, isGM, active: true, flags: {},
    getFlag(_m, name) { return this.flags[name]; },
    async setFlag(_m, path, value) { const [root, key] = path.split("."); (this.flags[root] ??= {})[key] = value; },
    async unsetFlag(_m, path) { const [root, key] = path.split("."); delete this.flags[root]?.[key]; }
  });
  const gm = makeUser("a-gm", true), player = makeUser("player", false), other = makeUser("other", false);
  const users = new Map([gm, player, other].map(user => [user.id, user]));
  const makeGame = user => ({ user, users, world: { id: "world" }, settings: { get: () => true },
    socket: { on: (_channel, listener) => listeners.push(listener), emit: (_channel, message) => {
      traffic.push(message); for (const listener of listeners) queueMicrotask(() => listener(structuredClone(message)));
    } } });
  return { gm, player, other, users, traffic, makeGame };
}

test("encrypted socket authenticates document keys, elects one GM, suppresses duplicates and hides answers", async () => {
  const fixture = socketFixture(); let calls = 0;
  const make = user => new ComputerSocketService({ gameProvider: () => fixture.makeGame(user), cryptoProvider: webcrypto,
    aiClient: { query: async () => { calls++; return { answer: "PRIVATE-ORBITAL-FACT" }; } } });
  const gm = make(fixture.gm), player = make(fixture.player), other = make(fixture.other);
  gm.ready = true;
  await gm.publish(); await other.publish();
  for (const service of [gm, player, other]) fixture.makeGame(fixture.player).socket.on("channel", service.listener);
  const answer = await player.query("Private question");
  assert.equal(answer, "PRIVATE-ORBITAL-FACT");
  assert.equal(calls, 1);
  assert.equal(chooseGm(fixture.users).clientId, gm.clientId);
  assert.ok(!JSON.stringify(fixture.traffic).includes("PRIVATE-ORBITAL-FACT"));
  assert.ok(!JSON.stringify(fixture.traffic).includes("Private question"));
  await gm.receive(fixture.traffic.find(message => message.type === "query"));
  assert.equal(calls, 1);
  const response = fixture.traffic.find(message => message.type === "response");
  await assert.rejects(other.receive({ ...response, toUser: fixture.other.id, toClient: other.clientId }));
  await assert.rejects(gm.receive({ ...fixture.traffic[0], fromUser: fixture.other.id, fromClient: other.clientId }));
});

test("GM election ignores stale, disconnected and player session claims", () => {
  const fixture = socketFixture(); const now = Date.now();
  const record = (user, at, id = randomUUID()) => { user.flags.computerAiSessions = { [id]: { ready: true, at } }; return id; };
  record(fixture.player, now);
  record(fixture.gm, now - 100000);
  assert.equal(chooseGm(fixture.users, now), null);
  const id = record(fixture.gm, now);
  assert.equal(chooseGm(fixture.users, now).clientId, id);
  fixture.gm.active = false;
  assert.equal(chooseGm(fixture.users, now), null);
});

test("player bridge access is refused before any network or corpus read", async () => {
  const client = new ComputerAiClient({ gameProvider: () => ({ user: { isGM: false } }), fetcher: () => { throw new Error("Network must not run"); } });
  await assert.rejects(client.request("/health"), /GM only/);
});

test("session heartbeats do not trigger UI refresh but real user edits do", () => {
  assert.equal(isComputerSessionUpdate({ [`flags.${MODULE_ID}.computerAiSessions.someId`]: {} }), true);
  assert.equal(isComputerSessionUpdate({ flags: { [MODULE_ID]: { computerAiSessions: {} } } }), true);
  assert.equal(isComputerSessionUpdate({ name: "New name" }), false);
  assert.equal(isComputerSessionUpdate({ flags: { [MODULE_ID]: { other: true } } }), false);
  assert.equal(isComputerSessionUpdate({}), false);
});

test("long pages return the matching window instead of an unrelated prefix", () => {
  const store = new KnowledgeSessionStore();
  const data = { ...payload(), knowledge: [page("Long", "unrelated ".repeat(1500) + "NEEDLE-ORBITAL-RECORD" + " suffix".repeat(1200))] };
  const { token } = store.create(data);
  store.search(token, { requestId: data.requestId, query: "NEEDLE" });
  const result = store.read(token, { requestId: data.requestId, pageUuid: page("Long").pageUuid });
  assert.ok(result.text.includes("NEEDLE-ORBITAL-RECORD"));
  assert.ok(result.offset > 0);
  assert.ok(result.text.length <= 6000);
  assert.equal(result.truncated, true);
});

test("runner deadline terminates a real child process and returns a timeout", async () => {
  let child;
  const spawnProcess = (_exe, _args, options) => {
    child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], options);
    return child;
  };
  await assert.rejects(runCodex({ requestId: randomUUID(), question: "Test", token: "test",
    mcpUrl: "http://127.0.0.1:1/mcp", timeout: 100, spawnProcess }), /timed out/);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test("disconnecting the HTTP caller aborts work and removes its knowledge session", async t => {
  let started, aborted;
  const began = new Promise(resolve => { started = resolve; });
  const ended = new Promise(resolve => { aborted = resolve; });
  const bridge = await bridgeFixture(t, { runner: ({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => { aborted(); reject(new Error("Cancelled")); }, { once: true });
    started();
  }) });
  const controller = new AbortController();
  const response = fetch(`${bridge.url}/computer/query`, { method: "POST", headers: bridge.headers,
    body: JSON.stringify(payload()), signal: controller.signal }).catch(error => error);
  await began; controller.abort(); await ended; await response;
  // Allow the async server handler's finally block to run.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(bridge.store.sessions.size, 0);
});

test("GM election is deterministic across multiple GMs and browser tabs", () => {
  const fixture = socketFixture(); const now = Date.now();
  const low = "10000000-0000-4000-8000-000000000000", high = "20000000-0000-4000-8000-000000000000";
  fixture.gm.flags.computerAiSessions = { [high]: { ready: true, at: now }, [low]: { ready: true, at: now } };
  fixture.other.isGM = true;
  fixture.other.flags.computerAiSessions = { [low]: { ready: true, at: now } };
  assert.deepEqual(chooseGm(fixture.users, now), { userId: "a-gm", clientId: low, publicKey: undefined });
  assert.deepEqual(chooseGm([...fixture.users.values()].reverse(), now), chooseGm(fixture.users, now));
});

test("clear cancels a pending question and late answers cannot restore cleared history", async () => {
  const previousGame = globalThis.game, previousFoundry = globalThis.foundry;
  globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: Base => Base } } };
  globalThis.game = { i18n: { localize: key => key, format: key => key }, settings: { get: () => true } };
  try {
    const { StarfleetComputerApp } = await import("../scripts/apps/StarfleetComputerApp.js");
    const commands = new CommandRegistry(); registerCommands(commands);
    let answer, requestStarted; const started = new Promise(resolve => { requestStarted = resolve; });
    const app = new StarfleetComputerApp({ commandRegistry: commands, searchService: { search: async () => [] },
      computerSocket: { query: (_q, _context, signal) => { requestStarted(signal); return new Promise(resolve => { answer = resolve; }); } } });
    app.renderParts = async () => {}; app.rendered = true;
    const run = input => StarfleetComputerApp.runCommandAction.call(app, { preventDefault() {} },
      { closest: () => ({ elements: { command: { value: input } } }) });
    const pending = run("Что известно о колонии?");
    const signal = await started;
    await run("search colony"); // Local command still executes while AI runs.
    assert.ok(app.stateFor("computer").history.some(item => item.input === "search colony" && !item.error));
    await run("clear");
    assert.equal(signal.aborted, true);
    answer("Late answer"); await pending;
    assert.deepEqual(app.stateFor("computer").history, []);
    assert.equal(app.stateFor("computer").aiPending, false);
  } finally { globalThis.game = previousGame; globalThis.foundry = previousFoundry; }
});
