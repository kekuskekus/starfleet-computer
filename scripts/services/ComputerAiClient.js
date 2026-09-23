import { MODULE_ID, SETTINGS } from "../constants.js";
import { KB_LIMITS, localBridgeUrl } from "./computerKnowledgeProtocol.js";

export class ComputerAiClient {
  constructor({ knowledgeService, gameProvider = () => game, fetcher = globalThis.fetch } = {}) {
    this.knowledge = knowledgeService; this.game = gameProvider; this.fetcher = fetcher;
    this.status = "offline"; this.lastError = "";
  }
  async request(path, body, signal) {
    if (!this.game().user?.isGM) throw new Error("GM only");
    const settings = this.game().settings;
    const token = settings.get(MODULE_ID, SETTINGS.COMPUTER_BRIDGE_TOKEN);
    if (!token) throw new Error("Pairing required");
    const url = localBridgeUrl(settings.get(MODULE_ID, SETTINGS.COMPUTER_BRIDGE_URL));
    const response = await this.fetcher(`${url}${path}`, { method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal, credentials: "omit", redirect: "error", cache: "no-store" });
    if (!response.ok) throw new Error(`Bridge HTTP ${response.status}`);
    return response.json();
  }
  async refresh() {
    try {
      const result = await this.request("/health", null, AbortSignal.timeout(12000));
      this.status = result.codex?.installed && result.codex?.authenticated ? "ready" : "login";
      this.lastError = "";
    } catch (error) { this.status = "offline"; this.lastError = error.message; }
    return this.status;
  }
  async query({ requestId, question, recentConversation }, signal) {
    try {
      const knowledge = this.knowledge.buildCorpus();
      if (!knowledge.length) throw new Error("Knowledge unavailable");
      const result = await this.request("/computer/query", { requestId, question, recentConversation, knowledge }, signal);
      if (typeof result.answer !== "string" || !result.answer.trim() || result.answer.length > KB_LIMITS.answer
        || !Array.isArray(result.sources)) throw new Error("Invalid bridge result");
      const allowed = new Set(knowledge.map(page => page.pageUuid));
      const sources = result.sources.filter(uuid => allowed.has(uuid));
      try { await this.knowledge.recordSources(sources, knowledge); }
      catch { console.warn(`${MODULE_ID} | Could not save discovery debug state`); }
      this.lastError = "";
      return { answer: result.answer }; // Never send source UUIDs or corpus through the socket.
    } catch (error) {
      this.lastError = signal?.aborted ? "Request cancelled" : "Computer request failed; check bridge console, corpus and Codex login.";
      throw error;
    }
  }
}
