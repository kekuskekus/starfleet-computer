// Shared browser/bridge bounds. No Foundry globals or Node dependencies here.
export const KB_LIMITS = Object.freeze({ question: 2000, answer: 6000, history: 8, context: 12000,
  pages: 2000, corpus: 4_000_000, page: 100_000, searches: 3, results: 5,
  reads: 4, excerpt: 400, retrieved: 18000, timeout: 120000, sessionTtl: 150000 });
export const REQUEST_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const PAGE_UUID = /^JournalEntry\.[A-Za-z0-9_-]+\.JournalEntryPage\.[A-Za-z0-9_-]+$/;

export function recentContext(history = []) {
  let remaining = KB_LIMITS.context;
  return history.filter(item => item?.kind === "ai" && !item.error && !item.pending)
    .slice(-KB_LIMITS.history).reverse().map(item => {
      const question = String(item.input ?? "").slice(0, Math.min(KB_LIMITS.question, remaining));
      remaining -= question.length;
      const answer = (item.lines ?? []).join("\n").slice(0, Math.min(KB_LIMITS.answer, remaining));
      remaining -= answer.length;
      return { question, answer };
    }).filter(item => item.question && item.answer).reverse();
}

export function validateQuestion(question) {
  if (typeof question !== "string" || !question.trim() || question.length > KB_LIMITS.question) {
    throw new Error("Invalid question");
  }
  return question.trim();
}

export function localBridgeUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Bridge URL must be a localhost origin");
  }
  return url.origin;
}
