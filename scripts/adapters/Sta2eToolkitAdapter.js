import { TOOLKIT_ID } from "../constants.js";

const SYSTEM_FLAG = "starSystem";
const SCENE_ACTOR_FLAG = "starSystemSceneActor";
const SCENE_WORLD_FLAG = "starSystemSceneWorld";

function collectionValues(collection) {
  return Array.from(collection?.contents ?? collection?.values?.() ?? collection ?? []);
}

export class Sta2eToolkitAdapter {
  constructor({ gameProvider = () => game, permissionService = null } = {}) {
    this.gameProvider = gameProvider;
    this.permissions = permissionService;
  }

  get game() {
    return this.gameProvider();
  }

  isModuleActive() {
    return this.game?.modules?.get(TOOLKIT_ID)?.active === true;
  }

  isAvailable() {
    return this.isModuleActive() && Boolean(this.game?.sta2eToolkit);
  }

  isStarSystemActor(actor) {
    return actor?.getFlag?.(TOOLKIT_ID, SYSTEM_FLAG)?.isStarSystem === true;
  }

  getStarSystemData(actor) {
    if (!this.isStarSystemActor(actor)) return null;
    const data = actor.getFlag(TOOLKIT_ID, SYSTEM_FLAG) ?? {};
    return {
      ...data,
      actorId: actor.id,
      uuid: actor.uuid,
      name: actor.name,
      designation: data.designation || actor.name,
      image: actor.img
    };
  }

  getStarSystems({ permissionService } = {}) {
    const actors = collectionValues(this.game?.actors);
    return actors
      .filter(actor => this.isStarSystemActor(actor))
      .filter(actor => !permissionService || permissionService.canView(actor))
      .map(actor => this.getStarSystemData(actor));
  }

  getActor(actorOrId) {
    if (typeof actorOrId === "object") return actorOrId;
    return this.game?.actors?.get(actorOrId) ?? null;
  }

  openStarSystemSheet(actorOrId) {
    const actor = this.getActor(actorOrId);
    if (!actor || !this.isAvailable()) return false;
    const open = this.game.sta2eToolkit?.openStarSystemSheet;
    if (typeof open !== "function") return false;
    open(actor);
    return true;
  }

  getSystemScenes(actorOrId) {
    const actor = this.getActor(actorOrId);
    if (!actor) return [];
    return collectionValues(this.game?.scenes)
      .filter(scene => scene.getFlag?.(TOOLKIT_ID, SCENE_ACTOR_FLAG) === actor.id)
      .filter(scene => !this.permissions || this.permissions.canView(scene));
  }

  getPlanetScenes(actorOrId, worldId = null) {
    return this.getSystemScenes(actorOrId).filter(scene => {
      const sceneWorldId = scene.getFlag?.(TOOLKIT_ID, SCENE_WORLD_FLAG);
      return Boolean(sceneWorldId) && (!worldId || sceneWorldId === worldId);
    });
  }

  getMainSystemScene(actorOrId) {
    return this.getSystemScenes(actorOrId).find(scene =>
      !scene.getFlag?.(TOOLKIT_ID, SCENE_WORLD_FLAG)
    ) ?? null;
  }

  async openSystemScene(actorOrId) {
    const scene = this.getMainSystemScene(actorOrId);
    if (!scene) return false;
    if (typeof scene.view === "function") await scene.view();
    else scene.sheet?.render(true);
    return true;
  }

  getCampaign() {
    if (!this.isAvailable()) return null;
    return this.game.sta2eToolkit?.getActiveCampaign?.() ?? null;
  }

  getStardate() {
    const campaign = this.getCampaign();
    const value = campaign?.stardate ?? this.game?.sta2eToolkit?.getCurrentStardate?.();
    return value === null || value === undefined || value === 0 ? "—" : String(value);
  }

  getTheme() {
    return this.getCampaign()?.theme ?? "lcars-tng";
  }
}
