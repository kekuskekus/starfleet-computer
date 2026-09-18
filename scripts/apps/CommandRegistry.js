export class CommandRegistry {
  constructor() {
    this.commands = new Map();
    this.aliases = new Map();
  }

  register(definition) {
    if (!definition?.id || typeof definition.execute !== "function") throw new Error("Command requires id and execute");
    const id = definition.id.toLocaleLowerCase();
    if (this.commands.has(id)) throw new Error(`Command already registered: ${id}`);
    const command = Object.freeze({ description: "", aliases: [], ...definition, id });
    this.commands.set(id, command);
    for (const alias of command.aliases) this.aliases.set(String(alias).toLocaleLowerCase(), id);
    return id;
  }

  unregister(id) {
    const key = String(id).toLocaleLowerCase();
    const removed = this.commands.delete(key);
    for (const [alias, commandId] of this.aliases) if (commandId === key) this.aliases.delete(alias);
    return removed;
  }

  get(id) {
    const key = String(id).toLocaleLowerCase();
    return this.commands.get(this.aliases.get(key) ?? key) ?? null;
  }

  list() {
    return Array.from(this.commands.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  async execute(input, context = {}) {
    const raw = String(input ?? "").trim();
    if (!raw) return { lines: [] };
    const [name, ...rest] = raw.split(/\s+/);
    const command = this.get(name) ?? this.get("search");
    const argument = command?.id === "search" && !this.get(name) ? raw : rest.join(" ");
    return command.execute({ input: raw, argument, registry: this, ...context });
  }
}
