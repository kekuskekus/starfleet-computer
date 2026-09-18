import { APP_IDS } from "../constants.js";

function countLine(results) {
  return `${results.length} RECORD${results.length === 1 ? "" : "S"} FOUND`;
}

export function registerCommands(registry) {
  registry.register({
    id: "help",
    description: "List available commands",
    execute: async ({ registry }) => ({
      lines: registry.list().map(command => `${command.id}${command.aliases.length ? ` (${command.aliases.join(", ")})` : ""} — ${command.description}`)
    })
  });
  registry.register({ id: "home", description: "Return to Home", execute: async () => ({ navigate: APP_IDS.HOME, lines: ["HOME"] }) });
  registry.register({ id: "clear", description: "Clear terminal output", execute: async () => ({ clear: true, lines: [] }) });
  registry.register({
    id: "search", description: "Search all accessible records",
    execute: async ({ argument, search }) => {
      if (!argument) return { lines: ["USAGE: search <query>"] };
      const results = await search.search(argument);
      return { lines: [countLine(results)], results };
    }
  });
  registry.register({
    id: "open", description: "Open an exact terminal path",
    execute: async ({ argument, search }) => {
      if (!argument) return { lines: ["USAGE: open <path>"] };
      const result = await search.resolvePath(argument);
      return result ? { lines: ["OPENING RECORD"], results: [result], autoOpen: result } : { lines: ["PATH NOT FOUND"] };
    }
  });
  registry.register({
    id: "logs", description: "Search Ship Logs",
    execute: async ({ argument, search }) => {
      const results = await search.search(argument, { appIds: [APP_IDS.LOGS] });
      return { lines: [countLine(results)], results };
    }
  });
  registry.register({
    id: "crew", description: "Search crew profiles",
    execute: async ({ argument, search }) => {
      const results = await search.search(argument, { appIds: [APP_IDS.CREW] });
      return { lines: [countLine(results)], results };
    }
  });
  const systemCommand = id => registry.register({
    id, aliases: id === "system" ? ["map"] : [], description: "Find a Toolkit Star System",
    execute: async ({ argument, search }) => {
      const results = await search.search(argument, { types: ["star-system"] });
      return { lines: [countLine(results)], results, autoOpen: results.length === 1 ? results[0] : null };
    }
  });
  systemCommand("system");
}
