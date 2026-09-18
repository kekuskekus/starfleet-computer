import { NAV_ORDER } from "../constants.js";

export class ComputerAppRegistry {
  constructor() {
    this.apps = new Map();
  }

  register(definition) {
    if (!definition?.id || !definition?.label) throw new Error("Computer app requires id and label");
    if (this.apps.has(definition.id)) throw new Error(`Computer app already registered: ${definition.id}`);
    this.apps.set(definition.id, Object.freeze({ icon: "fa-solid fa-circle", order: 100, ...definition }));
    return definition.id;
  }

  unregister(id) {
    return this.apps.delete(id);
  }

  get(id) {
    return this.apps.get(id) ?? null;
  }

  list() {
    return Array.from(this.apps.values()).sort((a, b) => {
      const ai = NAV_ORDER.indexOf(a.id);
      const bi = NAV_ORDER.indexOf(b.id);
      return (ai < 0 ? a.order : ai) - (bi < 0 ? b.order : bi) || a.label.localeCompare(b.label);
    });
  }
}
