import { APP_IDS } from "../constants.js";

export function registerBuiltins(registry) {
  registry.register({
    id: APP_IDS.HOME,
    label: "STARFLEET.App.Home",
    icon: "fa-solid fa-house",
    async prepare({ registry: apps }) {
      return { view: "home", apps: apps.list().filter(app => app.id !== APP_IDS.HOME) };
    }
  });
  registry.register({
    id: APP_IDS.DATABASE,
    label: "STARFLEET.App.Database",
    icon: "fa-solid fa-database",
    async prepare({ data }) {
      const entries = await data.getDatabaseEntries();
      const grouped = new Map();
      for (const entry of entries) {
        const category = entry.category || "Uncategorized";
        if (!grouped.has(category)) grouped.set(category, []);
        grouped.get(category).push(entry);
      }
      const groups = Array.from(grouped, ([label, records]) => ({ label, records }));
      return { view: "database", entries, groups };
    }
  });
  registry.register({
    id: APP_IDS.LOGS,
    label: "STARFLEET.App.Logs",
    icon: "fa-solid fa-book",
    async prepare({ data }) { return { view: "logs", entries: await data.getLogs() }; }
  });
  registry.register({
    id: APP_IDS.CREW,
    label: "STARFLEET.App.Crew",
    icon: "fa-solid fa-user-group",
    async prepare({ data }) { return { view: "crew", entries: data.getCrew() }; }
  });
  registry.register({
    id: APP_IDS.FILES,
    label: "STARFLEET.App.Files",
    icon: "fa-solid fa-folder-tree",
    async prepare({ data }) { return { view: "files", entries: await data.getFiles() }; }
  });
  registry.register({ id: APP_IDS.COMMS, label: "STARFLEET.App.Comms", icon: "fa-solid fa-satellite-dish", toolkitIndependent: true });
  registry.register({ id: APP_IDS.ASTROMETRICS, label: "STARFLEET.App.Astrometrics", icon: "fa-solid fa-globe", toolkitDependent: true });
  registry.register({ id: APP_IDS.COMPUTER, label: "STARFLEET.App.Computer", icon: "fa-solid fa-terminal", toolkitIndependent: true });
}
