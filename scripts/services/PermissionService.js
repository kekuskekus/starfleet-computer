export class PermissionService {
  constructor(userProvider = () => game.user) {
    this.userProvider = userProvider;
  }

  canView(document, user = this.userProvider()) {
    if (!document || !user) return false;
    if (user.isGM) return true;
    const observer = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 2;
    if (typeof document.testUserPermission === "function") {
      return document.testUserPermission(user, observer, { exact: false });
    }
    const ownership = document.ownership ?? {};
    return (ownership[user.id] ?? ownership.default ?? 0) >= observer;
  }

  filter(documents, user = this.userProvider()) {
    const values = documents?.contents ?? documents?.values?.() ?? documents ?? [];
    return Array.from(values).filter(document => this.canView(document, user));
  }
}
