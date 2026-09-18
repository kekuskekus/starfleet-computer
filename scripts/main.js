import { MODULE_ID, SETTINGS } from "./constants.js";
import { registerSettings, getSetting } from "./settings.js";
import { Sta2eToolkitAdapter } from "./adapters/Sta2eToolkitAdapter.js";
import { PermissionService } from "./services/PermissionService.js";
import { DocumentResolver } from "./services/DocumentResolver.js";
import { ComputerDataService } from "./services/ComputerDataService.js";
import { CommunicationService } from "./services/CommunicationService.js";
import { ComputerAppRegistry } from "./apps/ComputerAppRegistry.js";
import { registerBuiltins } from "./apps/registerBuiltins.js";
import { StarfleetComputerApp } from "./apps/StarfleetComputerApp.js";
import * as components from "./components.js";

let computer = null;
let services = null;
let refreshTimer = null;

function playerAccessAllowed() {
  return game.user?.isGM || getSetting(SETTINGS.PLAYER_ACCESS);
}

async function openComputer() {
  if (!playerAccessAllowed()) {
    ui.notifications.warn(game.i18n.localize("STARFLEET.Warning.PlayerAccessDisabled"));
    return null;
  }
  if (!computer) computer = new StarfleetComputerApp(services);
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
    unregisterComputerApp(id) {
      const removed = services.registry.unregister(id);
      if (removed && computer?.rendered) computer.navigate("home", { remember: false });
      return removed;
    },
    get toolkit() { return services.toolkitAdapter; },
    get communications() { return services.communicationService; },
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

function computerTool() {
  return {
    name: MODULE_ID,
    title: "STARFLEET.Title",
    icon: "fa-solid fa-computer",
    visible: playerAccessAllowed(),
    button: true,
    onChange: () => openComputer()
  };
}

function addSceneControl(controls) {
  const tool = computerTool();
  if (Array.isArray(controls)) {
    const control = controls.find(entry => entry.name === "token") ?? controls[0];
    if (control && !control.tools?.some(entry => entry.name === MODULE_ID)) control.tools.push(tool);
    return;
  }
  const control = controls.tokens ?? controls.token ?? Object.values(controls)[0];
  if (!control) return;
  if (Array.isArray(control.tools)) {
    if (!control.tools.some(entry => entry.name === MODULE_ID)) control.tools.push(tool);
  } else if (control.tools && !control.tools[MODULE_ID]) {
    control.tools[MODULE_ID] = tool;
  }
}

Hooks.once("init", () => {
  registerSettings();
  const permissionService = new PermissionService();
  const toolkitAdapter = new Sta2eToolkitAdapter({ permissionService });
  const registry = new ComputerAppRegistry();
  registerBuiltins(registry);
  const documentResolver = new DocumentResolver(permissionService);
  const dataService = new ComputerDataService({ permissionService, toolkitAdapter });
  services = {
    registry,
    permissionService,
    toolkitAdapter,
    documentResolver,
    dataService,
    communicationService: new CommunicationService({ dataService, permissionService, documentResolver })
  };
  exposeApi();
  Hooks.on("getSceneControlButtons", addSceneControl);
  for (const documentName of ["JournalEntry", "Actor", "Scene", "Folder"]) {
    Hooks.on(`create${documentName}`, queueComputerRefresh);
    Hooks.on(`update${documentName}`, queueComputerRefresh);
    Hooks.on(`delete${documentName}`, queueComputerRefresh);
  }
  Hooks.on("updateUser", (user) => {
    if (user.id === game.user?.id) queueComputerRefresh();
  });
});

Hooks.once("ready", () => {
  if (!services.toolkitAdapter.isAvailable() && game.user?.isGM) {
    ui.notifications.error(game.i18n.localize("STARFLEET.Warning.ToolkitUnavailable"), { permanent: true });
  }
});

Hooks.on("closeStarfleetComputerApp", () => {
  computer = null;
});
