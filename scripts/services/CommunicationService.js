import { MODULE_ID, SETTINGS } from "../constants.js";

function collectionValues(collection) {
  return Array.from(collection?.contents ?? collection?.values?.() ?? collection ?? []);
}

function moduleFlags(document) {
  return document?.flags?.[MODULE_ID] ?? {};
}

function groupsFor(document) {
  const groups = document?.getFlag?.(MODULE_ID, "groups") ?? moduleFlags(document).groups ?? [];
  return Array.isArray(groups) ? groups.map(String) : [];
}

export function normalizeRecipient(recipient) {
  if (!recipient) return null;
  if (typeof recipient === "object") {
    const type = String(recipient.type ?? "").toLowerCase();
    const id = String(recipient.id ?? recipient.value ?? "");
    if (["everyone", "user", "actor", "group"].includes(type)) {
      return { type, id: type === "everyone" ? "everyone" : id, label: recipient.label ?? id };
    }
    return null;
  }
  const value = String(recipient).trim();
  if (!value) return null;
  if (value.toLowerCase() === "everyone") return { type: "everyone", id: "everyone", label: "Everyone" };
  const separator = value.indexOf(":");
  if (separator < 1) return null;
  const type = value.slice(0, separator).toLowerCase();
  const id = value.slice(separator + 1);
  return ["user", "actor", "group"].includes(type) && id ? { type, id, label: id } : null;
}

export function normalizeRecipients(flags = {}) {
  const source = Array.isArray(flags.recipients) ? flags.recipients : [flags.recipient ?? "everyone"];
  return source.map(normalizeRecipient).filter(Boolean);
}

export function recipientMatchesAudience(recipient, audience) {
  if (recipient.type === "everyone") return true;
  if (recipient.type === "user") return audience.userIds.has(recipient.id);
  if (recipient.type === "actor") return audience.actorIds.has(recipient.id);
  if (recipient.type === "group") return audience.groups.has(recipient.id);
  return false;
}

export function messageMatchesAudience(recipients, audience) {
  return recipients.some(recipient => recipientMatchesAudience(recipient, audience));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  })[character]);
}

function bodyToHtml(value) {
  return String(value ?? "").split(/\r?\n\r?\n/).map(paragraph =>
    `<p>${escapeHtml(paragraph).replace(/\r?\n/g, "<br>")}</p>`
  ).join("");
}

export class CommunicationService {
  constructor({ dataService, permissionService, documentResolver } = {}) {
    this.data = dataService;
    this.permissions = permissionService;
    this.documents = documentResolver;
  }

  audienceFor(user = game.user) {
    const owner = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
    const actorIds = new Set();
    const groups = new Set(groupsFor(user));
    if (user?.character) {
      actorIds.add(user.character.id);
      actorIds.add(user.character.uuid);
      groupsFor(user.character).forEach(group => groups.add(group));
    }
    for (const actor of collectionValues(game.actors)) {
      if (actor.testUserPermission?.(user, owner, { exact: false })) {
        actorIds.add(actor.id);
        actorIds.add(actor.uuid);
        groupsFor(actor).forEach(group => groups.add(group));
      }
    }
    return { userIds: new Set([user?.id, user?.uuid, user?.name].filter(Boolean)), actorIds, groups };
  }

  readIds(user = game.user) {
    const ids = user?.getFlag?.(MODULE_ID, "communicationsRead") ?? moduleFlags(user).communicationsRead ?? [];
    return new Set(Array.isArray(ids) ? ids.map(String) : []);
  }

  isAddressedTo(entry, user = game.user) {
    if (user?.isGM) return true;
    return messageMatchesAudience(normalizeRecipients(moduleFlags(entry)), this.audienceFor(user));
  }

  async getMessages({ user = game.user } = {}) {
    const entries = this.data.journalsFor(SETTINGS.COMMS_FOLDER);
    const audience = this.audienceFor(user);
    const read = this.readIds(user);
    const records = [];
    for (const entry of entries) {
      const flags = moduleFlags(entry);
      if (flags.app && flags.app !== "comms") continue;
      const recipients = normalizeRecipients(flags);
      if (!user?.isGM && !messageMatchesAudience(recipients, audience)) continue;
      const base = await this.data.journalRecord(entry, "communication");
      records.push({
        ...base,
        sender: flags.sender || base.author,
        recipients,
        recipientLabel: flags.recipientLabel || recipients.map(item => item.label).join(", "),
        subject: flags.subject || base.title,
        timestamp: flags.timestamp || base.date,
        priority: flags.priority || "normal",
        encrypted: flags.encrypted === true,
        attachmentUuid: flags.attachmentUuid || "",
        image: flags.image || "",
        isRead: read.has(entry.uuid),
        isUnread: !read.has(entry.uuid)
      });
    }
    return records.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)) || a.subject.localeCompare(b.subject));
  }

  async getUnreadCount(user = game.user) {
    const messages = await this.getMessages({ user });
    return messages.reduce((count, message) => count + (message.isUnread ? 1 : 0), 0);
  }

  async markRead(uuid, user = game.user) {
    if (!uuid || !user?.setFlag) return false;
    const ids = this.readIds(user);
    if (ids.has(uuid)) return true;
    ids.add(uuid);
    await user.setFlag(MODULE_ID, "communicationsRead", Array.from(ids).slice(-1000));
    return true;
  }

  getRecipientOptions() {
    const options = [{ value: "everyone", label: game.i18n.localize("STARFLEET.Comms.Everyone") }];
    for (const user of collectionValues(game.users)) {
      options.push({ value: `user:${user.id}`, label: `${game.i18n.localize("STARFLEET.Comms.User")}: ${user.name}` });
    }
    for (const actor of collectionValues(game.actors)) {
      options.push({ value: `actor:${actor.id}`, label: `${game.i18n.localize("STARFLEET.Comms.Actor")}: ${actor.name}` });
    }
    const groups = new Set();
    for (const document of [...collectionValues(game.users), ...collectionValues(game.actors)]) {
      groupsFor(document).forEach(group => groups.add(group));
    }
    for (const group of Array.from(groups).sort()) {
      options.push({ value: `group:${group}`, label: `${game.i18n.localize("STARFLEET.Comms.Group")}: ${group}` });
    }
    return options;
  }

  ownershipFor(recipient) {
    const none = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.NONE ?? 0;
    const observer = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 2;
    const ownership = { default: none };
    if (recipient.type === "everyone") {
      ownership.default = observer;
      return ownership;
    }
    if (recipient.type === "user") ownership[recipient.id] = observer;
    if (recipient.type === "actor") {
      const actor = game.actors?.get(recipient.id);
      for (const user of collectionValues(game.users)) {
        if (user.isGM || user.character?.id === actor?.id || actor?.testUserPermission?.(user, 3, { exact: false })) {
          ownership[user.id] = observer;
        }
      }
    }
    if (recipient.type === "group") {
      for (const user of collectionValues(game.users)) {
        if (user.isGM || this.audienceFor(user).groups.has(recipient.id)) ownership[user.id] = observer;
      }
    }
    return ownership;
  }

  async createMessage(values) {
    if (!game.user?.isGM) throw new Error(game.i18n.localize("STARFLEET.Comms.GMOnly"));
    const folderId = this.data.configuredFolderId(SETTINGS.COMMS_FOLDER);
    const folder = game.folders?.get(folderId);
    if (!folder || folder.type !== "JournalEntry") throw new Error(game.i18n.localize("STARFLEET.Comms.FolderRequired"));
    const recipient = normalizeRecipient(values.recipient);
    if (!recipient) throw new Error(game.i18n.localize("STARFLEET.Comms.RecipientRequired"));
    const selectedOption = this.getRecipientOptions().find(option => option.value === values.recipient);
    recipient.label = selectedOption?.label?.replace(/^[^:]+:\s*/, "") || recipient.label;
    const subject = String(values.subject ?? "").trim();
    const body = String(values.body ?? "").trim();
    if (!subject || !body) throw new Error(game.i18n.localize("STARFLEET.Comms.SubjectBodyRequired"));
    const timestamp = values.timestamp ? new Date(values.timestamp).toISOString() : new Date().toISOString();
    const metadata = {
      app: "comms",
      sender: String(values.sender || game.user.name),
      recipients: [recipient],
      recipientLabel: recipient.label,
      subject,
      timestamp,
      priority: ["normal", "priority", "urgent"].includes(values.priority) ? values.priority : "normal",
      encrypted: values.encrypted === true || values.encrypted === "on",
      image: String(values.image ?? "").trim(),
      attachmentUuid: String(values.attachmentUuid ?? "").trim()
    };
    return JournalEntry.create({
      name: subject,
      folder: folderId,
      ownership: this.ownershipFor(recipient),
      flags: { [MODULE_ID]: metadata },
      pages: [{
        name: subject,
        type: "text",
        text: { format: 1, content: bodyToHtml(body) }
      }]
    });
  }
}
