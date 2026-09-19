import { APP_IDS } from "../constants.js";

function localize(key, fallback, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return fallback.replace(/\{(\w+)\}/g, (_match, name) => data[name] ?? "");
  const localized = Object.keys(data).length ? i18n.format(key, data) : i18n.localize(key);
  return localized && localized !== key ? localized : fallback;
}

function countLine(results) {
  return localize("STARFLEET.Command.RecordsFound", `${results.length} records found`, { count: results.length });
}

export function registerCommands(registry) {
  registry.register({
    id: "help",
    aliases: ["помощь", "справка", "команды"],
    description: "STARFLEET.Command.Help",
    execute: async ({ registry }) => ({
      lines: registry.list().map(command => `${command.id}${command.aliases.length ? ` (${command.aliases.join(", ")})` : ""} — ${localize(command.description, command.description)}`)
    })
  });
  registry.register({ id: "home", aliases: ["главная", "домой"], description: "STARFLEET.Command.Home", execute: async () => ({ navigate: APP_IDS.HOME, lines: [localize("STARFLEET.App.Home", "Home")] }) });
  registry.register({ id: "clear", aliases: ["очистить", "очистка"], description: "STARFLEET.Command.Clear", execute: async () => ({ clear: true, lines: [] }) });
  registry.register({
    id: "search", aliases: ["поиск", "найти", "ищи"], description: "STARFLEET.Command.Search",
    execute: async ({ argument, search }) => {
      if (!argument) return { lines: [localize("STARFLEET.Command.Usage.Search", "Usage: search <query>")] };
      const results = await search.search(argument);
      return { lines: [countLine(results)], results };
    }
  });
  registry.register({
    id: "open", aliases: ["открыть"], description: "STARFLEET.Command.Open",
    execute: async ({ argument, search }) => {
      if (!argument) return { lines: [localize("STARFLEET.Command.Usage.Open", "Usage: open <path>")] };
      const result = await search.resolvePath(argument);
      return result
        ? { lines: [localize("STARFLEET.Command.Opening", "Opening record")], results: [result], autoOpen: result }
        : { lines: [localize("STARFLEET.Command.PathNotFound", "Path not found")] };
    }
  });

  const scopedSearch = ({ id, aliases, appId, description }) => registry.register({
    id, aliases, description,
    execute: async ({ argument, search }) => {
      if (!argument) return { navigate: appId, lines: [] };
      const results = await search.search(argument, { appIds: [appId] });
      return { lines: [countLine(results)], results };
    }
  });
  scopedSearch({ id: "logs", aliases: ["журналы", "журнал", "логи"], appId: APP_IDS.LOGS, description: "STARFLEET.Command.Logs" });
  scopedSearch({ id: "database", aliases: ["база", "данные", "база-данных"], appId: APP_IDS.DATABASE, description: "STARFLEET.Command.Database" });
  scopedSearch({ id: "crew", aliases: ["экипаж"], appId: APP_IDS.CREW, description: "STARFLEET.Command.Crew" });
  scopedSearch({ id: "relations", aliases: ["отношения", "отношение"], appId: APP_IDS.RELATIONS, description: "STARFLEET.Command.Relations" });
  scopedSearch({ id: "files", aliases: ["файлы", "файл"], appId: APP_IDS.FILES, description: "STARFLEET.Command.Files" });
  scopedSearch({ id: "comms", aliases: ["связь", "сообщения"], appId: APP_IDS.COMMS, description: "STARFLEET.Command.Comms" });

  registry.register({
    id: "astrometrics", aliases: ["астрометрика"], description: "STARFLEET.Command.Astrometrics",
    execute: async () => ({ navigate: APP_IDS.ASTROMETRICS, lines: [] })
  });
  registry.register({
    id: "system", aliases: ["map", "система", "системы", "карта"], description: "STARFLEET.Command.System",
    execute: async ({ argument, search }) => {
      if (!argument) return { navigate: APP_IDS.ASTROMETRICS, lines: [] };
      const results = await search.search(argument, { types: ["star-system"] });
      return { lines: [countLine(results)], results, autoOpen: results.length === 1 ? results[0] : null };
    }
  });
}
