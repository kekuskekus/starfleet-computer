export const MODULE_ID = "starfleet-computer";
export const TOOLKIT_ID = "sta2e-toolkit";

export const SETTINGS = Object.freeze({
  PLAYER_ACCESS: "playerAccess",
  COMPUTER_KNOWLEDGE_FOLDER: "computerKnowledgeFolder",
  COMPUTER_BRIDGE_URL: "computerBridgeUrl",
  COMPUTER_BRIDGE_TOKEN: "computerBridgeToken",
  COMPUTER_DISCOVERY_JOURNAL: "computerDiscoveryJournal",
  CREW_FOLDER: "crewFolder",
  CREW_JOURNALS_FOLDER: "crewJournalsFolder",
  RELATIONSHIPS_FOLDER: "relationshipsFolder",
  DATABASE_FOLDER: "databaseFolder",
  COMMS_FOLDER: "commsFolder"
});

export const APP_IDS = Object.freeze({
  HOME: "home",
  DATABASE: "database",
  CREW: "crew",
  RELATIONS: "relations",
  COMMS: "comms",
  ASTROMETRICS: "astrometrics",
  COMPUTER: "computer"
});

export const NAV_ORDER = Object.freeze([
  APP_IDS.HOME,
  APP_IDS.DATABASE,
  APP_IDS.CREW,
  APP_IDS.RELATIONS,
  APP_IDS.COMMS,
  APP_IDS.ASTROMETRICS,
  APP_IDS.COMPUTER
]);
