import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { KnowledgeSessionStore } from "./knowledge-session-store.js";
import { handleMcp } from "./mcp-server.js";
import { runCodex, checkCodex } from "./codex-runner.js";

const sameSecret = (a, b) => typeof a === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const json = (res, status, data) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };

async function readJson(req, max = 20_000_000) {
  if (!req.headers["content-type"]?.startsWith("application/json")) throw new Error("JSON required");
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > max) throw new Error("Request too large"); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createBridge({ origins = [], pairingToken = randomBytes(32).toString("hex"),
  store = new KnowledgeSessionStore(), runner = runCodex, health = checkCodex, logger = console } = {}) {
  const allowedOrigins = new Set(origins.map(origin => new URL(origin).origin));
  const active = new Map();
  let cachedHealth = null, healthAt = 0;
  const server = createServer(async (req, res) => {
    let token;
    try {
      const host = req.headers.host ?? "";
      if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) return json(res, 403, { error: "Host rejected" });
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin)) return json(res, 403, { error: "Origin rejected" });
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Access-Control-Allow-Private-Network", "true");
      }
      if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
      const path = new URL(req.url, `http://${host}`).pathname;
      const bearer = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
      if (path === "/mcp") {
        if (origin) return json(res, 403, { error: "MCP is for local Codex only" });
        try { store.get(bearer); } catch { return json(res, 401, { error: "Session unavailable" }); }
        if (req.method !== "POST") { res.writeHead(405); return res.end(); }
        return await handleMcp(req, res, await readJson(req, 20000), store, bearer);
      }
      if (!sameSecret(bearer, pairingToken)) return json(res, 401, { error: "Pairing required" });
      if (path === "/health" && req.method === "GET") {
        if (!cachedHealth || Date.now() - healthAt > 30000) { cachedHealth = await health(); healthAt = Date.now(); }
        return json(res, 200, { bridge: true, codex: cachedHealth, busy: active.size > 0 });
      }
      if (path !== "/computer/query" || req.method !== "POST") return json(res, 404, { error: "Not found" });
      if (active.size) return json(res, 429, { error: "Computer busy; retry shortly" });
      // Reserve before reading body so simultaneous clients cannot bypass the single-process bound.
      const controller = new AbortController();
      active.set(res, controller);
      res.on("close", () => { if (!res.writableEnded) controller.abort(); });
      try {
        const { token: sessionToken, session } = store.create(await readJson(req));
        token = sessionToken;
        const output = await runner({ requestId: session.requestId, question: session.question, token,
          mcpUrl: `http://127.0.0.1:${server.address().port}/mcp`, signal: controller.signal });
        const result = store.validateResult(token, output);
        // Final validated sources are authoritative; the optional recording tool cannot add hidden pages.
        if (!res.destroyed) json(res, 200, result);
      } finally { active.delete(res); if (token) store.delete(token); }
    } catch (error) {
      const safeMessages = new Set(["Codex timed out", "Request cancelled", "Codex output limit exceeded",
        "Codex execution failed; check login and account limits", "Codex did not return a structured answer",
        "Invalid request ID", "Invalid question", "Invalid knowledge corpus", "Invalid knowledge page",
        "Invalid Codex result", "Session unavailable", "Request too large", "JSON required"]);
      const detail = safeMessages.has(error.message) || /^Codex exited with code -?\d+$/.test(error.message)
        ? error.message : error.code === "ENOENT" ? "Codex executable not found" : "request failed (invalid payload or transport error)";
      logger.error(`Starfleet bridge: ${detail}`);
      if (!res.headersSent && !res.destroyed) json(res, 400, { error: "Computer request failed. Check bridge, corpus and Codex login." });
      else if (!res.destroyed) res.end();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  const sweep = setInterval(() => store.sweep(), 15000);
  sweep.unref();
  server.on("close", () => { clearInterval(sweep); for (const controller of active.values()) controller.abort(); store.sessions.clear(); });
  return { server, pairingToken, store };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origins = (process.env.STARFLEET_FOUNDRY_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean);
  if (!origins.length) throw new Error("Set STARFLEET_FOUNDRY_ORIGINS to your Foundry origin, e.g. https://foundry.example.com");
  const port = Number(process.env.STARFLEET_BRIDGE_PORT || 32123);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid bridge port");
  const { server, pairingToken } = createBridge({ origins, pairingToken: process.env.STARFLEET_BRIDGE_TOKEN || undefined });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Starfleet Computer bridge: http://127.0.0.1:${port}`);
    console.log(`Local pairing code (GM browser only): ${pairingToken}`);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { server.close(); server.closeAllConnections(); });
}
