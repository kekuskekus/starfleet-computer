import { APP_IDS, SETTINGS } from "../constants.js";

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
    id: APP_IDS.CREW,
    label: "STARFLEET.App.Crew",
    icon: "fa-solid fa-user-group",
    async prepare({ data, crewJournals, state }) {
      const tab = state.tab === "journals" ? "journals" : "profiles";
      const profiles = data.getCrew();
      const journals = await crewJournals.getJournals();
      return {
        view: "crew",
        tab,
        entries: tab === "journals" ? journals : profiles,
        profiles,
        journals,
        canConfigure: game.user?.isGM === true,
        selectedFolderId: data.configuredFolderId(SETTINGS.CREW_FOLDER),
        folderOptions: data.getCrewFolderOptions()
      };
    }
  });
  registry.register({
    id: APP_IDS.RELATIONS,
    label: "STARFLEET.App.Relations",
    icon: "fa-solid fa-handshake",
    async prepare({ relationships }) {
      return {
        view: "relations",
        entries: relationships.getRelations(),
        canAdd: game.user?.isGM === true
      };
    }
  });
  registry.register({
    id: APP_IDS.COMMS,
    label: "STARFLEET.App.Comms",
    icon: "fa-solid fa-satellite-dish",
    async prepare({ communications }) {
      return {
        view: "comms",
        entries: await communications.getMessages(),
        recipientOptions: game.user?.isGM ? communications.getRecipientOptions() : [],
        canCompose: game.user?.isGM === true,
        defaultSender: game.user?.name ?? "",
        defaultTimestamp: new Date().toISOString().slice(0, 16)
      };
    }
  });
  registry.register({
    id: APP_IDS.ASTROMETRICS,
    label: "STARFLEET.App.Astrometrics",
    icon: "fa-solid fa-globe",
    toolkitDependent: true,
    async prepare({ astrometrics, state, selectedId }) {
      return astrometrics.getBrowser({ filters: state.filters, selectedId });
    }
  });
  registry.register({
    id: APP_IDS.COMPUTER,
    label: "STARFLEET.App.Computer",
    icon: "fa-solid fa-terminal",
    async prepare({ state }) {
      return { view: "computer", history: state.history ?? [] };
    }
  });
}
