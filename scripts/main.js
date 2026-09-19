import { MODULE_ID, SETTINGS } from "./constants.js";
import { registerSettings, getSetting } from "./settings.js";
import { Sta2eToolkitAdapter } from "./adapters/Sta2eToolkitAdapter.js";
import { PermissionService } from "./services/PermissionService.js";
import { DocumentResolver } from "./services/DocumentResolver.js";
import { ComputerDataService } from "./services/ComputerDataService.js";
import { CommunicationService } from "./services/CommunicationService.js";
import { CrewJournalService } from "./services/CrewJournalService.js";
import { AstrometricsService } from "./services/AstrometricsService.js";
import { SearchService } from "./services/SearchService.js";
import { ComputerAppRegistry } from "./apps/ComputerAppRegistry.js";
import { CommandRegistry } from "./apps/CommandRegistry.js";
import { registerBuiltins } from "./apps/registerBuiltins.js";
import { registerCommands } from "./apps/registerCommands.js";
import * as components from "./components.js";

let computer = null;
let ComputerAppClass = null;
let services = null;
let refreshTimer = null;
let crewSyncTimer = null;

function playerAccessAllowed() {
  return game.user?.isGM || getSetting(SETTINGS.PLAYER_ACCESS);
}

async function openComputer() {
  if (!playerAccessAllowed()) {
    ui.notifications.warn(game.i18n.localize("STARFLEET.Warning.PlayerAccessDisabled"));
    return null;
  }
  if (!services) {
    ui.notifications.warn(game.i18n.localize("STARFLEET.Warning.NotReady"));
    return null;
  }
  try {
    if (!ComputerAppClass) {
      ({ StarfleetComputerApp: ComputerAppClass } = await import("./apps/StarfleetComputerApp.js"));
    }
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to load the Computer window`, error);
    ui.notifications.error(game.i18n.localize("STARFLEET.Warning.LoadFailed"));
    return null;
  }
  if (!computer) computer = new ComputerAppClass(services);
  await computer.render({ force: true });
  computer.bringToFront?.();
  return computer;
}

async function closeComputer() {
  if (!computer) return;
  await computer.close();
  computer = null;
}

async function toggleComputer() {
  if (computer?.rendered) return closeComputer();
  return openComputer();
}

function registerComputerApp(definition) {
  const id = services.registry.register(definition);
  if (computer?.rendered) computer.renderParts(["navigation", "content"]);
  return id;
}

function exposeApi() {
  const api = {
    openComputer,
    closeComputer,
    toggleComputer,
    registerComputerApp,
    registerCommand(definition) {
      return services.commandRegistry.register(definition);
    },
    unregisterCommand(id) {
      return services.commandRegistry.unregister(id);
    },
    unregisterComputerApp(id) {
      const removed = services.registry.unregister(id);
      if (removed && computer?.rendered) computer.navigate("home", { remember: false });
      return removed;
    },
    get toolkit() { return services.toolkitAdapter; },
    get communications() { return services.communicationService; },
    get crewJournals() { return services.crewJournalService; },
    get search() { return services.searchService; },
    syncCrewJournals() {
      return services.crewJournalService.sync();
    },
    components
  };
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = api;
  return api;
}

function queueComputerRefresh() {
  if (!computer) return;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    computer?.renderParts().catch(error => console.error(`${MODULE_ID} | Refresh failed`, error));
  }, 75);
}

function queueCrewJournalSync() {
  if (!game.user?.isGM || !services?.crewJournalService) return;
  if (crewSyncTimer) clearTimeout(crewSyncTimer);
  crewSyncTimer = setTimeout(async () => {
    crewSyncTimer = null;
    try {
      await services.crewJournalService.sync();
      queueComputerRefresh();
    } catch (error) {
      console.error(`${MODULE_ID} | Crew journal synchronization failed`, error);
    }
  }, 150);
}

function addJournalDirectoryButton(_app, html) {
  if (!playerAccessAllowed()) return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? html;
  if (!root || root.querySelector(".starfleet-open-computer")) return;
  const actions = root.querySelector(".directory-header .header-actions")
    ?? root.querySelector(".header-actions")
    ?? root.querySelector(".directory-header");
  if (!actions) return;

  const label = game.i18n.localize("STARFLEET.OpenComputer");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "starfleet-open-computer";
  button.title = label;
  button.innerHTML = `<i class="fas fa-computer"></i><span>${label}</span>`;
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openComputer();
  });
  actions.append(button);
}

Hooks.on("renderJournalDirectory", addJournalDirectoryButton);

Hooks.once("init", () => {
  registerSettings();
  const permissionService = new PermissionService();
  const toolkitAdapter = new Sta2eToolkitAdapter({ permissionService });
  const registry = new ComputerAppRegistry();
  registerBuiltins(registry);
  const commandRegistry = new CommandRegistry();
  registerCommands(commandRegistry);
  const documentResolver = new DocumentResolver(permissionService);
  const dataService = new ComputerDataService({ permissionService, toolkitAdapter });
  const communicationService = new CommunicationService({ dataService, permissionService, documentResolver });
  const crewJournalService = new CrewJournalService({ dataService, permissionService });
  services = {
    registry,
    permissionService,
    toolkitAdapter,
    documentResolver,
    dataService,
    communicationService,
    crewJournalService,
    astrometricsService: new AstrometricsService({ toolkitAdapter, permissionService }),
    searchService: new SearchService({ dataService, permissionService, toolkitAdapter, communicationService }),
    commandRegistry
  };
  exposeApi();
  for (const documentName of ["JournalEntry", "Actor", "Scene", "Folder"]) {
    Hooks.on(`create${documentName}`, queueComputerRefresh);
    Hooks.on(`update${documentName}`, queueComputerRefresh);
    Hooks.on(`delete${documentName}`, queueComputerRefresh);
  }
  Hooks.on("updateUser", (user) => {
    if (user.id === game.user?.id) queueComputerRefresh();
  });
  for (const hook of ["createActor", "updateActor", "deleteActor"]) Hooks.on(hook, queueCrewJournalSync);
  Hooks.on(`${MODULE_ID}.crewFolderChanged`, queueCrewJournalSync);
});

Hooks.once("ready", queueCrewJournalSync);

Hooks.on("closeStarfleetComputerApp", () => {
  computer = null;
});
