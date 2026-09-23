import { randomBytes } from "node:crypto";
import { KB_LIMITS, REQUEST_ID, PAGE_UUID, validateQuestion } from "../scripts/services/computerKnowledgeProtocol.js";
import { normalizeSearchText, searchTerms } from "../scripts/services/SearchService.js";

export class KnowledgeSessionStore {
  constructor({ now = Date.now, ttl = KB_LIMITS.sessionTtl } = {}) { this.sessions = new Map(); this.now = now; this.ttl = ttl; }

  create({ requestId, question, knowledge, recentConversation = [] }) {
    this.sweep();
    if (!REQUEST_ID.test(requestId)) throw new Error("Invalid request ID");
    validateQuestion(question);
    if (!Array.isArray(knowledge) || !knowledge.length || knowledge.length > KB_LIMITS.pages
      || JSON.stringify(knowledge).length > KB_LIMITS.corpus) throw new Error("Invalid knowledge corpus");
    const pages = new Map();
    for (const page of knowledge) {
      if (!PAGE_UUID.test(page.pageUuid) || page.journalUuid !== page.pageUuid.split(".JournalEntryPage.")[0]
        || typeof page.text !== "string" || page.text.length > KB_LIMITS.page
        || typeof page.pageTitle !== "string" || page.pageTitle.length > 500
        || typeof page.journalTitle !== "string" || page.journalTitle.length > 500 || pages.has(page.pageUuid)) {
        throw new Error("Invalid knowledge page");
      }
      pages.set(page.pageUuid, { journalUuid: page.journalUuid, journalTitle: page.journalTitle,
        pageUuid: page.pageUuid, pageTitle: page.pageTitle, text: page.text });
    }
    const context = Array.isArray(recentConversation) ? recentConversation.slice(-KB_LIMITS.history)
      .filter(item => typeof item?.question === "string" && typeof item?.answer === "string")
      .map(item => ({ question: item.question.slice(0, KB_LIMITS.question), answer: item.answer.slice(0, KB_LIMITS.answer) })) : [];
    while (JSON.stringify(context).length > KB_LIMITS.context) context.shift();
    const token = randomBytes(32).toString("hex");
    const session = { requestId, question, pages, context, created: this.now(), expires: this.now() + this.ttl,
      searches: 0, reads: 0, characters: 0, candidates: new Set(), offsets: new Map(), retrieved: new Set(), revealed: new Set() };
    this.sessions.set(token, session);
    return { token, session };
  }

  get(token, requestId) {
    const session = this.sessions.get(token);
    if (!session || session.expires <= this.now()) { this.sessions.delete(token); throw new Error("Session unavailable"); }
    if (requestId !== undefined && session.requestId !== requestId) throw new Error("Wrong request");
    return session;
  }
  delete(token) { this.sessions.delete(token); }
  sweep() { for (const [token, session] of this.sessions) if (session.expires <= this.now()) this.sessions.delete(token); }

  search(token, { requestId, query, limit = 3 }) {
    const session = this.get(token, requestId);
    if (typeof query !== "string" || query.length > 500 || !Number.isInteger(limit) || limit < 1) throw new Error("Invalid search");
    if (++session.searches > KB_LIMITS.searches) throw new Error("Search budget exhausted");
    const terms = searchTerms(query);
    if (!terms.length) return { results: [] };
    const matches = text => terms.reduce((score, term) => score + Number(text.includes(term)
      || (/^[а-я]+$/u.test(term) && term.length >= 5 && text.includes(term.slice(0, -2)))), 0);
    const ranked = [...session.pages.values()].map(page => ({ page,
      score: matches(normalizeSearchText(`${page.journalTitle} ${page.pageTitle}`)) * 8 + matches(normalizeSearchText(page.text))
    })).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.page.pageUuid.localeCompare(b.page.pageUuid));
    return { results: ranked.slice(0, Math.min(limit, KB_LIMITS.results)).map(({ page }) => {
      const normalized = normalizeSearchText(page.text);
      const position = Math.max(0, Math.min(...terms.map(term => normalized.indexOf(term)).filter(index => index >= 0)) - 100);
      const start = Number.isFinite(position) ? position : 0;
      const excerpt = page.text.slice(start, start + KB_LIMITS.excerpt);
      session.candidates.add(page.pageUuid);
      session.offsets.set(page.pageUuid, Math.max(0, start - 1000));
      session.retrieved.add(page.pageUuid);
      return { id: page.pageUuid, journalTitle: page.journalTitle, pageTitle: page.pageTitle, excerpt };
    }) };
  }

  read(token, { requestId, pageUuid }) {
    const session = this.get(token, requestId);
    if (!PAGE_UUID.test(pageUuid) || !session.pages.has(pageUuid) || !session.candidates.has(pageUuid)) throw new Error("Page unavailable: search first");
    if (++session.reads > KB_LIMITS.reads || session.characters >= KB_LIMITS.retrieved) throw new Error("Read budget exhausted");
    const page = session.pages.get(pageUuid);
    const offset = session.offsets.get(pageUuid) ?? 0;
    const text = page.text.slice(offset, offset + Math.min(6000, KB_LIMITS.retrieved - session.characters));
    session.characters += text.length;
    session.retrieved.add(pageUuid);
    return { ...page, text, offset, truncated: offset > 0 || text.length < page.text.length };
  }

  validateResult(token, result) {
    const session = this.get(token);
    if (!result || typeof result.answer !== "string" || !result.answer.trim() || result.answer.length > KB_LIMITS.answer
      || !Array.isArray(result.sources)) throw new Error("Invalid Codex result");
    return { answer: result.answer, sources: [...new Set(result.sources.filter(uuid => session.retrieved.has(uuid)))] };
  }
}
