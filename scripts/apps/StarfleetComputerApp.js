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

  constructor({ registry, dataService, permissionService, documentResolver, toolkitAdapter, communicationService } = {}, options = {}) {
    super(options);
    this.registry = registry;
    this.dataService = dataService;
    this.permissions = permissionService;
    this.documents = documentResolver;
    this.toolkit = toolkitAdapter;
    this.communications = communicationService;
    this.activeAppId = APP_IDS.HOME;
    this.history = [];
    this.selectedId = null;
    this.loading = false;
    this.showComposer = false;
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
