export class DocumentResolver {
  constructor(permissionService) {
    this.permissions = permissionService;
  }

  async resolve(uuid) {
    if (!uuid || typeof globalThis.fromUuid !== "function") return null;
    const document = await globalThis.fromUuid(uuid);
    return this.permissions.canView(document) ? document : null;
  }

  async open(uuid, { sheet = true } = {}) {
    const document = await this.resolve(uuid);
    if (!document) return null;
    if (sheet) document.sheet?.render(true);
    return document;
  }
}
