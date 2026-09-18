import { MODULE_ID, SETTINGS } from "./constants.js";

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.PLAYER_ACCESS, {
    name: "STARFLEET.Settings.PlayerAccess.Name",
    hint: "STARFLEET.Settings.PlayerAccess.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  const folders = [
    [SETTINGS.LOGS_FOLDER, "LogsFolder"],
    [SETTINGS.DATABASE_FOLDER, "DatabaseFolder"],
    [SETTINGS.FILES_FOLDER, "FilesFolder"],
    [SETTINGS.COMMS_FOLDER, "CommsFolder"]
  ];

  for (const [key, label] of folders) {
    game.settings.register(MODULE_ID, key, {
      name: `STARFLEET.Settings.${label}.Name`,
      hint: `STARFLEET.Settings.${label}.Hint`,
      scope: "world",
      config: true,
      type: String,
      default: ""
    });
  }
}

export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}
