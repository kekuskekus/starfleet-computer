function uniqueOptions(values, selectedValue) {
  return Array.from(new Set(values.filter(Boolean).map(String)))
    .sort((a, b) => a.localeCompare(b))
    .map(value => ({ value, label: value, selected: value === selectedValue }));
}

function normalize(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function displayBodies(items) {
  return Array.isArray(items) ? items.map((item, index) => ({
    id: item?.id ?? item?._id ?? String(index),
    name: item?.name ?? item?.designation ?? item?.type ?? `#${index + 1}`,
    detail: item?.classification ?? item?.class ?? item?.type ?? ""
  })) : [];
}

export class AstrometricsService {
  constructor({ toolkitAdapter, permissionService } = {}) {
    this.toolkit = toolkitAdapter;
    this.permissions = permissionService;
  }

  allSystems() {
    return this.toolkit.getStarSystems({ permissionService: this.permissions })
      .sort((a, b) => String(a.designation).localeCompare(String(b.designation)));
  }

  filterSystems(systems, filters = {}) {
    const query = normalize(filters.query);
    return systems.filter(system => {
      if (filters.sector && system.sector !== filters.sector) return false;
      if (filters.region && system.region !== filters.region) return false;
      if (filters.affiliation && system.affiliation !== filters.affiliation) return false;
      if (filters.travelCode && system.travelCode !== filters.travelCode) return false;
      if (!query) return true;
      const haystack = [
        system.designation, system.name, system.classification, system.sector,
        system.region, system.affiliation, system.travelCode, system.strategicValue,
        system.primaryStar, ...displayBodies(system.worlds).map(world => world.name)
      ].join(" ").toLocaleLowerCase();
      return haystack.includes(query);
    });
  }

  systemRecord(system) {
    if (!system) return null;
    const systemScene = this.toolkit.getMainSystemScene(system.actorId);
    const worlds = displayBodies(system.worlds);
    const worldNames = new Map(worlds.map(world => [String(world.id), world.name]));
    const planetScenes = this.toolkit.getPlanetScenes(system.actorId).map(scene => {
      const worldId = this.toolkit.getSceneWorldId(scene);
      return {
        id: scene.id,
        uuid: scene.uuid,
        name: scene.name,
        worldId,
        worldName: worldNames.get(String(worldId)) || scene.name
      };
    });
    return {
      ...system,
      coordinatesLabel: [system.coordinates?.x, system.coordinates?.y, system.coordinates?.z]
        .map(value => value ?? "—").join(" / "),
      worlds,
      starsDisplay: displayBodies(system.stars),
      systemScene: systemScene ? { id: systemScene.id, uuid: systemScene.uuid, name: systemScene.name } : null,
      planetScenes
    };
  }

  getBrowser({ filters = {}, selectedId = null } = {}) {
    const all = this.allSystems();
    const systems = this.filterSystems(all, filters);
    const selectedSystem = all.find(system => system.actorId === selectedId || system.uuid === selectedId)
      ?? systems[0]
      ?? null;
    return {
      view: "astrometrics",
      systems,
      selected: this.systemRecord(selectedSystem),
      filters: {
        query: filters.query ?? "",
        sector: filters.sector ?? "",
        region: filters.region ?? "",
        affiliation: filters.affiliation ?? "",
        travelCode: filters.travelCode ?? ""
      },
      sectorOptions: uniqueOptions(all.map(system => system.sector), filters.sector),
      regionOptions: uniqueOptions(all.map(system => system.region), filters.region),
      affiliationOptions: uniqueOptions(all.map(system => system.affiliation), filters.affiliation),
      travelCodeOptions: uniqueOptions(all.map(system => system.travelCode), filters.travelCode)
    };
  }
}
