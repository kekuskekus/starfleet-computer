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
      selectCommunication: StarfleetComputerApp.selectCommunicationAction,
      toggleComposer: StarfleetComputerApp.toggleComposerAction,
      createMessage: StarfleetComputerApp.createMessageAction,
      openAttachment: StarfleetComputerApp.openAttachmentAction,
      applyAstrometricsFilters: StarfleetComputerApp.applyAstrometricsFiltersAction,
      resetAstrometricsFilters: StarfleetComputerApp.resetAstrometricsFiltersAction,
      selectSystem: StarfleetComputerApp.selectSystemAction,
      openScene: StarfleetComputerApp.openSceneAction,
      runCommand: StarfleetComputerApp.runCommandAction,
      openSearchResult: StarfleetComputerApp.openSearchResultAction,
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

  constructor({ registry, dataService, permissionService, documentResolver, toolkitAdapter, communicationService, astrometricsService, searchService, commandRegistry } = {}, options = {}) {
    super(options);
    this.registry = registry;
    this.dataService = dataService;
    this.permissions = permissionService;
    this.documents = documentResolver;
    this.toolkit = toolkitAdapter;
    this.communications = communicationService;
    this.astrometrics = astrometricsService;
    this.search = searchService;
    this.commands = commandRegistry;
    this.activeAppId = APP_IDS.HOME;
    this.history = [];
    this.selectedId = null;
    this.loading = false;
    this.showComposer = false;
    this.appState = new Map();
  }

  stateFor(appId) {
    if (!this.appState.has(appId)) {
      const initial = appId === APP_IDS.ASTROMETRICS
        ? { filters: { query: "", sector: "", region: "", affiliation: "", travelCode: "" } }
        : appId === APP_IDS.COMPUTER
          ? { history: [{ input: "", lines: [game.i18n.localize("STARFLEET.Terminal.Ready")], results: [] }] }
          : {};
      this.appState.set(appId, initial);
    }
    return this.appState.get(appId);
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
              communications: this.communications,
              astrometrics: this.astrometrics,
              search: this.search,
              commands: this.commands,
              registry: this.registry,
              selectedId: this.selectedId,
              state: this.stateFor(activeApp.id)
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

    if (appContext.view === "comms") appContext.showComposer = this.showComposer;

    const unreadCommunications = appContext.view === "comms"
      ? appContext.entries.reduce((count, entry) => count + (entry.isUnread ? 1 : 0), 0)
      : await this.communications.getUnreadCount();

    const apps = this.registry.list().map(app => ({
      ...app,
      labelText: game.i18n.localize(app.label),
      active: app.id === activeApp?.id,
      disabled: Boolean(app.toolkitDependent && !this.toolkit.isAvailable()),
      badge: app.id === APP_IDS.COMMS && unreadCommunications > 0 ? unreadCommunications : null
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

  _onRender(context, options) {
    super._onRender(context, options);
    for (const form of this.element.querySelectorAll(".sf-terminal-form, .sf-astro-filters")) {
      form.addEventListener("submit", event => {
        event.preventDefault();
        form.querySelector("[data-submit-action]")?.click();
      });
    }
    const terminal = this.element.querySelector(".sf-terminal-output");
    if (terminal) terminal.scrollTop = terminal.scrollHeight;
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

  static async selectCommunicationAction(_event, target) {
    this.selectedId = target.dataset.id;
    try {
      await this.communications.markRead(target.dataset.uuid);
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to persist communication read state`, error);
      ui.notifications.warn(game.i18n.localize("STARFLEET.Comms.ReadStateFailed"));
    }
    return this.renderParts(["navigation", "content"]);
  }

  static toggleComposerAction() {
    this.showComposer = !this.showComposer;
    return this.renderParts(["content"]);
  }

  static async createMessageAction(event, target) {
    event.preventDefault();
    const form = target.closest("form");
    if (!form) return;
    const values = Object.fromEntries(new FormData(form).entries());
    values.encrypted = form.elements.encrypted?.checked === true;
    try {
      const message = await this.communications.createMessage(values);
      this.showComposer = false;
      this.selectedId = message.id;
      ui.notifications.info(game.i18n.localize("STARFLEET.Comms.Sent"));
      await this.renderParts(["navigation", "content"]);
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to create communication`, error);
      ui.notifications.error(error?.message || String(error));
    }
  }

  static async openAttachmentAction(_event, target) {
    const document = await this.documents.resolve(target.dataset.uuid);
    if (!document) {
      ui.notifications.warn(game.i18n.localize("STARFLEET.Comms.AttachmentUnavailable"));
      return;
    }
    if (this.toolkit.isStarSystemActor(document)) {
      await this.navigate(APP_IDS.ASTROMETRICS, { selectedId: document.id });
      return;
    }
    if (document.documentName === "Scene" && typeof document.view === "function") {
      await document.view();
      return;
    }
    document.sheet?.render(true);
  }

  static applyAstrometricsFiltersAction(event, target) {
    event.preventDefault();
    const form = target.closest("form");
    if (!form) return;
    const values = Object.fromEntries(new FormData(form).entries());
    this.stateFor(APP_IDS.ASTROMETRICS).filters = {
      query: String(values.query ?? "").trim(),
      sector: values.sector ?? "",
      region: values.region ?? "",
      affiliation: values.affiliation ?? "",
      travelCode: values.travelCode ?? ""
    };
    return this.renderParts(["content"]);
  }

  static resetAstrometricsFiltersAction() {
    this.stateFor(APP_IDS.ASTROMETRICS).filters = { query: "", sector: "", region: "", affiliation: "", travelCode: "" };
    return this.renderParts(["content"]);
  }

  static selectSystemAction(_event, target) {
    this.selectedId = target.dataset.actorId;
    return this.renderParts(["content"]);
  }

  static async openSceneAction(_event, target) {
    const scene = await this.documents.resolve(target.dataset.uuid);
    if (!scene) {
      ui.notifications.warn(game.i18n.localize("STARFLEET.Astrometrics.SceneUnavailable"));
      return;
    }
    if (typeof scene.view === "function") await scene.view();
    else scene.sheet?.render(true);
  }

  async openResult(result) {
    if (!result) return;
    if (result.type === "star-system") {
      await this.navigate(APP_IDS.ASTROMETRICS, { selectedId: result.actorId || result.id });
      return;
    }
    if (result.type === "communication") {
      await this.communications.markRead(result.uuid);
    }
    if (result.appId && this.registry.get(result.appId)) {
      await this.navigate(result.appId, { selectedId: result.id });
      return;
    }
    await this.documents.open(result.uuid);
  }

  static async runCommandAction(event, target) {
    event.preventDefault();
    const form = target.closest("form");
    const input = form?.elements?.command?.value?.trim();
    if (!input) return;
    const state = this.stateFor(APP_IDS.COMPUTER);
    try {
      const result = await this.commands.execute(input, { search: this.search });
      if (result.clear) state.history = [];
      else state.history.push({ input, lines: result.lines ?? [], results: result.results ?? [] });
      state.history = state.history.slice(-50);
      if (result.navigate) {
        await this.navigate(result.navigate);
        return;
      }
      if (result.autoOpen) {
        await this.openResult(result.autoOpen);
        return;
      }
      await this.renderParts(["content"]);
    } catch (error) {
      console.error(`${MODULE_ID} | Command failed`, error);
      state.history.push({ input, lines: [error?.message || String(error)], results: [], error: true });
      await this.renderParts(["content"]);
    }
  }

  static openSearchResultAction(_event, target) {
    return this.openResult({
      id: target.dataset.id,
      actorId: target.dataset.actorId,
      uuid: target.dataset.uuid,
      type: target.dataset.type,
      appId: target.dataset.appId || null
    });
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
