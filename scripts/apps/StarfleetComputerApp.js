import { APP_IDS, MODULE_ID } from "../constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class StarfleetComputerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "starfleet-computer",
    classes: ["starfleet-computer"],
    tag: "section",
    window: {
      title: "STARFLEET.Title",
      icon: "fa-solid fa-computer",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 1120,
      height: 700
    },
    actions: {
      navigate: StarfleetComputerApp.navigateAction,
      back: StarfleetComputerApp.backAction,
      home: StarfleetComputerApp.homeAction,
      selectEntry: StarfleetComputerApp.selectEntryAction,
      openDocument: StarfleetComputerApp.openDocumentAction,
      openCharacterSheet: StarfleetComputerApp.openCharacterSheetAction,
      openStarSystem: StarfleetComputerApp.openStarSystemAction,
      openSystemScene: StarfleetComputerApp.openSystemSceneAction
    }
  };

  static PARTS = {
    header: { template: `modules/${MODULE_ID}/templates/header.hbs` },
    navigation: { template: `modules/${MODULE_ID}/templates/navigation.hbs` },
    content: { template: `modules/${MODULE_ID}/templates/computer.hbs` }
  };

  constructor({ registry, dataService, permissionService, documentResolver, toolkitAdapter } = {}, options = {}) {
    super(options);
    this.registry = registry;
    this.dataService = dataService;
    this.permissions = permissionService;
    this.documents = documentResolver;
    this.toolkit = toolkitAdapter;
    this.activeAppId = APP_IDS.HOME;
    this.history = [];
    this.selectedId = null;
    this.loading = false;
  }

  async _prepareContext(options) {
    const activeApp = this.registry.get(this.activeAppId) ?? this.registry.get(APP_IDS.HOME);
    let appContext;
    if (this.loading) appContext = { view: "loading" };
    else {
      try {
        const prepare = activeApp?.prepare ?? activeApp?.render;
        appContext = prepare
          ? await prepare({
              data: this.dataService,
              toolkit: this.toolkit,
              registry: this.registry,
              selectedId: this.selectedId
            })
          : {
              view: activeApp?.id === APP_IDS.ASTROMETRICS ? "astrometrics" : "empty",
              emptyMessage: game.i18n.localize("STARFLEET.State.FutureModule")
            };
      } catch (error) {
        console.error(`${MODULE_ID} | Failed to prepare ${activeApp?.id}`, error);
        appContext = { view: "error", message: error?.message || String(error) };
      }
    }

    if (Array.isArray(appContext.entries)) {
      appContext.selected = appContext.entries.find(entry =>
        entry.id === this.selectedId || entry.uuid === this.selectedId
      ) ?? null;
    }

    if (appContext.view === "astrometrics" && this.selectedId) {
      const system = this.toolkit.getStarSystems({ permissionService: this.permissions })
        .find(entry => entry.actorId === this.selectedId || entry.uuid === this.selectedId);
      appContext.selected = system ?? null;
      appContext.systemSceneAvailable = Boolean(system && this.toolkit.getMainSystemScene(system.actorId));
    }

    const apps = this.registry.list().map(app => ({
      ...app,
      labelText: game.i18n.localize(app.label),
      active: app.id === activeApp?.id,
      disabled: Boolean(app.toolkitDependent && !this.toolkit.isAvailable())
    }));

    return {
      apps,
      activeApp,
      activeLabel: game.i18n.localize(activeApp?.label ?? "STARFLEET.Title"),
      content: appContext,
      worldName: this.dataService.getWorldName(),
      userName: game.user?.name ?? "—",
      stardate: this.toolkit.getStardate(),
      canGoBack: this.history.length > 0,
      toolkitAvailable: this.toolkit.isAvailable(),
      isGM: game.user?.isGM === true
    };
  }

  async renderParts(parts = ["header", "navigation", "content"]) {
    return this.render({ parts });
  }

  async navigate(id, { selectedId = null, remember = true } = {}) {
    const target = this.registry.get(id);
    if (!target) return false;
    if (target.toolkitDependent && !this.toolkit.isAvailable()) {
      ui.notifications.warn(game.i18n.localize("STARFLEET.Warning.ToolkitUnavailable"));
      return false;
    }
    if (remember && this.activeAppId !== id) {
      this.history.push({ appId: this.activeAppId, selectedId: this.selectedId });
    }
    this.activeAppId = id;
    this.selectedId = selectedId;
    this.loading = true;
    await this.renderParts(["content"]);
    this.loading = false;
    await this.renderParts();
    return true;
  }

  static navigateAction(_event, target) {
    return this.navigate(target.dataset.appId, { selectedId: target.dataset.id ?? null });
  }

  static async backAction() {
    const previous = this.history.pop();
    if (!previous) return;
    this.activeAppId = previous.appId;
    this.selectedId = previous.selectedId;
    await this.renderParts();
  }

  static homeAction() {
    return this.navigate(APP_IDS.HOME);
  }

  static selectEntryAction(_event, target) {
    this.selectedId = target.dataset.id;
    return this.renderParts(["content"]);
  }

  static openDocumentAction(_event, target) {
    return this.documents.open(target.dataset.uuid);
  }

  static async openCharacterSheetAction(_event, target) {
    const document = await this.documents.resolve(target.dataset.uuid);
    document?.sheet?.render(true);
  }

  static openStarSystemAction(_event, target) {
    return this.toolkit.openStarSystemSheet(target.dataset.actorId);
  }

  static openSystemSceneAction(_event, target) {
    return this.toolkit.openSystemScene(target.dataset.actorId);
  }
}
