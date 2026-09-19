export const MODULE_ID = "starfleet-computer";
export const TOOLKIT_ID = "sta2e-toolkit";

export const SETTINGS = Object.freeze({
  PLAYER_ACCESS: "playerAccess",
  CREW_FOLDER: "crewFolder",
  CREW_JOURNALS_FOLDER: "crewJournalsFolder",
  RELATIONSHIPS_FOLDER: "relationshipsFolder",
  LOGS_FOLDER: "logsFolder",
  DATABASE_FOLDER: "databaseFolder",
  FILES_FOLDER: "filesFolder",
  COMMS_FOLDER: "commsFolder"
});

export const APP_IDS = Object.freeze({
  HOME: "home",
  DATABASE: "database",
  LOGS: "logs",
  CREW: "crew",
  RELATIONS: "relations",
  FILES: "files",
  COMMS: "comms",
  ASTROMETRICS: "astrometrics",
  COMPUTER: "computer"
});

export const NAV_ORDER = Object.freeze([
  APP_IDS.HOME,
  APP_IDS.DATABASE,
  APP_IDS.LOGS,
  APP_IDS.CREW,
  APP_IDS.RELATIONS,
  APP_IDS.FILES,
  APP_IDS.COMMS,
  APP_IDS.ASTROMETRICS,
  APP_IDS.COMPUTER
]);
