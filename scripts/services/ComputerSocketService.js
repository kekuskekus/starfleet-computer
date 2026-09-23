import { MODULE_ID, SETTINGS } from "../constants.js";
import { KB_LIMITS, REQUEST_ID, validateQuestion } from "./computerKnowledgeProtocol.js";

const CHANNEL = `module.${MODULE_ID}`;
const FLAG = "computerAiSessions";
const MAX_AGE = 90000;
const values = collection => Array.from(collection?.contents ?? collection?.values?.() ?? collection ?? []);
const encode = value => new TextEncoder().encode(value);
const base64 = bytes => btoa(Array.from(new Uint8Array(bytes), byte => String.fromCharCode(byte)).join(""));
const unbase64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));

export function chooseGm(users, now = Date.now()) {
  return values(users).filter(user => user.active && user.isGM).flatMap(user =>
    Object.entries(user.getFlag(MODULE_ID, FLAG) ?? {}).filter(([clientId, record]) => REQUEST_ID.test(clientId)
      && record.ready === true && record.at > now - MAX_AGE && record.at <= now + MAX_AGE)
      .map(([clientId, record]) => ({ userId: user.id, clientId, publicKey: record.publicKey })))
    .sort((a, b) => a.userId.localeCompare(b.userId) || a.clientId.localeCompare(b.clientId))[0] ?? null;
}

export function isComputerSessionUpdate(changes = {}) {
  const keys = Object.keys(changes).filter(key => key !== "_id");
  return keys.length > 0 && keys.every(key => key.startsWith(`flags.${MODULE_ID}.${FLAG}`)
    || (key === "flags" && Object.keys(changes.flags ?? {}).every(scope => scope === MODULE_ID)
      && Object.keys(changes.flags?.[MODULE_ID] ?? {}).every(flag => flag === FLAG)));
}

// ECDH keys are published through permission-checked User document writes. The module
// socket is only an untrusted broadcast transport; neither sender IDs nor recipient filters authenticate it.
export class ComputerSocketService {
  constructor({ aiClient, gameProvider = () => game, cryptoProvider = globalThis.crypto } = {}) {
    this.ai = aiClient; this.game = gameProvider; this.crypto = cryptoProvider;
    this.clientId = cryptoProvider?.randomUUID?.() ?? null; this.pending = new Map(); this.running = new Map();
    this.seen = new Map(); this.ready = false;
    this.listener = message => { void this.receive(message).catch(() => {}); };
  }
  start() {
    this.game().socket.on(CHANNEL, this.listener);
    if (this.game().user.isGM) {
      void this.refresh().catch(() => {});
      this.heartbeat = setInterval(() => { void this.refresh().catch(() => {}); }, 30000);
    }
  }
  async identity() {
    if (!this.identityPromise) this.identityPromise = (async () => {
      if (!this.crypto?.subtle || !this.clientId) throw new Error("Secure browser context required");
      this.keys = await this.crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
      this.publicKey = await this.crypto.subtle.exportKey("jwk", this.keys.publicKey);
    })();
    await this.identityPromise;
  }
  async publish() {
    await this.identity();
    const user = this.game().user;
    const records = user.getFlag(MODULE_ID, FLAG) ?? {};
    for (const [id, record] of Object.entries(records)) {
      if (REQUEST_ID.test(id) && record.at < Date.now() - MAX_AGE * 4) await user.unsetFlag(MODULE_ID, `${FLAG}.${id}`);
    }
    await user.setFlag(MODULE_ID, `${FLAG}.${this.clientId}`, { publicKey: this.publicKey, ready: this.ready, at: Date.now() });
  }
  async refresh() {
    if (!this.game().user.isGM) return;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const configured = this.game().settings.get(MODULE_ID, SETTINGS.COMPUTER_KNOWLEDGE_FOLDER)
        && this.game().settings.get(MODULE_ID, SETTINGS.COMPUTER_BRIDGE_TOKEN);
      this.ready = Boolean(configured && await this.ai.refresh() === "ready");
      if (this.ready || this.keys) await this.publish();
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  peer(userId, clientId) {
    const user = this.game().users.get(userId);
    const record = user?.getFlag(MODULE_ID, FLAG)?.[clientId];
    if (!user?.active || !record?.publicKey) throw new Error("Unknown peer");
    return record.publicKey;
  }
  async sharedKey(publicKey) {
    await this.identity();
    const peer = await this.crypto.subtle.importKey("jwk", publicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
    return this.crypto.subtle.deriveKey({ name: "ECDH", public: peer }, this.keys.privateKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  aad(message) {
    return encode(JSON.stringify([this.game().world.id, message.type, message.requestId,
      message.fromUser, message.fromClient, message.toUser, message.toClient]));
  }
  async send(type, requestId, recipient, body) {
    const message = { type, requestId, fromUser: this.game().user.id, fromClient: this.clientId,
      toUser: recipient.userId, toClient: recipient.clientId };
    const key = await this.sharedKey(recipient.publicKey ?? this.peer(message.toUser, message.toClient));
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    message.data = base64(await this.crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: this.aad(message) }, key, encode(JSON.stringify(body))));
    message.iv = base64(iv);
    this.game().socket.emit(CHANNEL, message);
    // Foundry may not echo to the originating browser (GM asking their own terminal).
    if (message.toUser === this.game().user.id && message.toClient === this.clientId) void this.receive(message);
  }
  async query(question, recentConversation = [], signal) {
    validateQuestion(question);
    await this.publish();
    if (signal?.aborted) throw new Error("Cancelled");
    const gm = chooseGm(this.game().users);
    if (!gm) throw new Error("NoGM");
    const requestId = this.crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const cancel = () => {
        void this.send("cancel", requestId, gm, {}).catch(() => {});
        finish(new Error("Cancelled"));
      };
      const timer = setTimeout(() => { void this.send("cancel", requestId, gm, {}).catch(() => {}); finish(new Error("Timeout")); }, KB_LIMITS.timeout + 15000);
      const finish = (error, result) => {
        clearTimeout(timer); signal?.removeEventListener("abort", cancel); this.pending.delete(requestId);
        if (error) reject(error); else resolve(result);
      };
      this.pending.set(requestId, { gm, finish });
      signal?.addEventListener("abort", cancel, { once: true });
      void this.send("query", requestId, gm, { question, recentConversation }).catch(error => finish(error));
    });
  }
  async receive(message) {
    if (!message || !["query", "response", "cancel"].includes(message.type) || !REQUEST_ID.test(message.requestId)
      || !REQUEST_ID.test(message.fromClient) || message.toUser !== this.game().user.id || message.toClient !== this.clientId
      || typeof message.data !== "string" || message.data.length > 100000 || typeof message.iv !== "string" || message.iv.length !== 16) return;
    const key = await this.sharedKey(this.peer(message.fromUser, message.fromClient));
    const body = JSON.parse(new TextDecoder().decode(await this.crypto.subtle.decrypt({ name: "AES-GCM",
      iv: unbase64(message.iv), additionalData: this.aad(message) }, key, unbase64(message.data))));
    if (message.type === "response") {
      const pending = this.pending.get(message.requestId);
      if (!pending || pending.gm.userId !== message.fromUser || pending.gm.clientId !== message.fromClient) return;
      if (body.error) pending.finish(new Error("Unavailable"));
      else if (typeof body.answer === "string" && body.answer.length <= KB_LIMITS.answer) pending.finish(null, body.answer);
      return;
    }
    if (!this.game().user.isGM) return;
    const owner = `${message.fromUser}:${message.fromClient}:${message.requestId}`;
    if (message.type === "cancel") {
      this.seen.set(owner, Date.now()); // Also suppress a query which arrives after its cancellation.
      this.running.get(owner)?.abort(); return;
    }
    const gm = chooseGm(this.game().users);
    if (!this.ready || gm?.userId !== this.game().user.id || gm.clientId !== this.clientId
      || (!this.game().users.get(message.fromUser)?.isGM && !this.game().settings.get(MODULE_ID, SETTINGS.PLAYER_ACCESS))) return;
    for (const [id, at] of this.seen) if (at < Date.now() - KB_LIMITS.sessionTtl * 2) this.seen.delete(id);
    if (this.seen.has(owner)) return;
    this.seen.set(owner, Date.now());
    const recipient = { userId: message.fromUser, clientId: message.fromClient };
    if (this.running.size || this.seen.size > 200) return this.send("response", message.requestId, recipient, { error: true });
    const controller = new AbortController();
    this.running.set(owner, controller);
    const timer = setTimeout(() => controller.abort(), KB_LIMITS.timeout + 5000);
    try {
      validateQuestion(body.question);
      const answer = await this.ai.query({ requestId: message.requestId, question: body.question,
        recentConversation: Array.isArray(body.recentConversation) ? body.recentConversation : [] }, controller.signal);
      await this.send("response", message.requestId, recipient, answer);
    } catch {
      console.warn(`${MODULE_ID} | Computer request failed (${message.requestId})`);
      await this.send("response", message.requestId, recipient, { error: true });
    } finally { clearTimeout(timer); this.running.delete(owner); }
  }
}
