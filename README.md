# Starfleet Computer

LCARS-style player interface for a Foundry VTT v14 Star Trek Adventures 2e world. It uses Foundry Journals and Actors as canonical content and discovers existing `sta2e-toolkit` Star System Actors and generated Scenes instead of duplicating them.

This release implements SC-01 through SC-07:

- a resizable `ApplicationV2` shell with one instance per client;
- Home, persistent navigation, status, user, world and Toolkit stardate display;
- permission-filtered data services for Journals, Journal pages, Actors, Folders and Scenes;
- Database, Crew and NPC Relationships applications;
- persistent Communications with GM authoring, private recipients, unread state and UUID attachments;
- Astrometrics discovery, filtering and navigation over Toolkit Star System Actors and generated Scenes;
- permission-filtered local search and an extensible command terminal;
- a dedicated `Sta2eToolkitAdapter` for Star System discovery and public Toolkit actions;
- public API for opening the Computer and registering additional applications.

No orbital renderer or parallel Star System model is included. Toolkit Star System Actors and their existing generated Scenes remain canonical.

## Install

In Foundry VTT v14, open **Add-on Modules → Install Module**, paste this manifest URL, and install:

```text
https://github.com/kekuskekus/starfleet-computer/releases/latest/download/module.json
```

The module runs on Foundry VTT 13–14 without `sta2e-toolkit`. When Toolkit is installed and active, Astrometrics discovers its Star System Actors and existing generated Scenes. Without Toolkit, the rest of the Computer remains available and Toolkit-dependent controls stay disabled.

Open the Computer from its dedicated computer icon in the Scene Controls toolbar on the left. The control is shown to both GMs and players; player access to the window follows the **Allow player access** module setting.

## Configure content

### Optional Codex knowledge base

The existing **Computer** terminal can answer natural-language questions from a
GM-selected Journal folder through a local Codex CLI bridge and MCP. Configure the
folder and connection in the GM-only Computer knowledge panel. Players need no
Codex installation, and source Journals can remain GM-only. `ask` / `спроси` requests
an AI answer; `search`, navigation commands and Russian aliases remain local.
No OpenAI API key is required. See [setup, operation and limitations](docs/codex-knowledge-base.md).

### Existing application folders

Open **Configure Settings → Module Settings → Starfleet Computer**. Enter the Folder ID or Folder UUID for:

- Crew Actors
- Database
- Communications

The configured Journal folder and all descendant folders are read dynamically. Standard Foundry ownership controls visibility. A player who cannot observe a document will not see it in the Computer. The GM sees all records.

Crew includes only permitted Actors in the configured Crew Actor folder and its descendant folders. A GM can choose the folder from **Computer → Crew** instead of copying its ID into settings. Saving the choice creates a Foundry Journal folder named **Crew Journals** and one linked Journal Entry for every Actor in the selected folder. Existing journal page content is preserved during later synchronization. Optional display metadata can be stored directly in the module flag namespace:

```json
{
  "flags": {
    "starfleet-computer": {
      "app": "database",
      "category": "mission",
      "author": "Captain",
      "stardate": "49523.7",
      "terminalPath": "/database/mission-12",
      "order": 10,
      "role": "Chief Engineer",
      "species": "Human"
    }
  }
}
```

The flags are optional. Source documents remain canonical and are never copied.

## Database

**Database** is the knowledge browser. It combines three sources:

- Journal Entries in the configured Database folder and descendant folders;
- `sta2e-toolkit` Star System Actors, linked to Astrometrics;
- other Actors whose `flags["starfleet-computer"].app` value is `"database"`.

Database Journals are grouped by `flags["starfleet-computer"].category`; entries without a category appear under `general`.

Foundry ownership remains authoritative: users only see documents they can observe. MCP agents can update the same Journal Entries directly; the Computer reads their current titles, pages, folders and flags on refresh.

## Crew journals and MCP

Automatically created crew Journals use these flags:

```json
{
  "flags": {
    "starfleet-computer": {
      "app": "crew-journal",
      "actorUuid": "Actor.ABC123",
      "actorId": "ABC123",
      "category": "personnel",
      "terminalPath": "/crew/character-name/journal"
    }
  }
}
```

The `actorUuid` is the stable link MCP should use. MCP may edit Journal pages without touching these flags. The public API method `game.modules.get("starfleet-computer").api.syncCrewJournals()` creates any missing records without replacing existing page content.

## NPC relationships

Open **Relationships** and, as a GM, drag an NPC Actor from Foundry's Actors directory onto the drop area. The Computer creates the **NPC Relationships** Journal folder and a dedicated Journal Entry for that NPC. Dropping the same Actor again reuses the existing relationship.

The score starts at `0` and is limited to `-20` through `+20`. Only a GM can see and use the **−** and **+** controls. An optional reason entered before the click is stored with the old score, new score, user and timestamp, and is also written into the Journal page. Automatically created Journals grant observer access by default so players can view the relationship history without changing it; normal Foundry Journal ownership can be tightened afterward.

Relationship records use stable module flags so MCP can find and update them:

```json
{
  "flags": {
    "starfleet-computer": {
      "app": "relationship",
      "actorUuid": "Actor.NPC123",
      "actorId": "NPC123",
      "score": 4,
      "history": [],
      "terminalPath": "/relations/NPC123"
    }
  }
}
```

Preserve `app`, `actorUuid` and `actorId` when updating these Journals through MCP. The relationship tab and local search read the current flags and Journal page on refresh.

Search indexes only Journals, Journal pages and Actors that the current Foundry user can observe. Removing a user's observer permission from a relationship Journal also removes it and its page text from that user's search results.

## Communications

The GM creates transmissions from the Comms application. Messages are Journal Entries in the configured Communications folder and can be addressed to everyone, one Foundry User, one Actor, or a named group. The module sets Journal ownership to match the recipient and also filters the Computer inbox, so unrelated players do not receive private transmissions.

Read state is stored persistently on each User document. Attachments can reference permitted Journal pages, Actors, Toolkit Star Systems or Scenes by UUID. Star System attachments open in Astrometrics; Scene attachments use Foundry's normal Scene workflow.

Groups are optional arrays on User or Actor flags:

```json
{
  "flags": {
    "starfleet-computer": {
      "groups": ["bridge", "engineering"]
    }
  }
}
```

## Public API

```js
const api = game.modules.get("starfleet-computer").api;

api.openComputer();
api.closeComputer();
api.toggleComputer();

api.registerComputerApp({
  id: "science",
  label: "Science",
  icon: "fa-solid fa-flask",
  async prepare({ data, toolkit }) {
    return { view: "empty", emptyMessage: "Science station ready." };
  }
});

api.registerCommand({
  id: "status",
  description: "Show ship status",
  async execute() {
    return { lines: ["ALL SYSTEMS NOMINAL"] };
  }
});
```

## Astrometrics

Astrometrics automatically lists permitted Actors whose `flags["sta2e-toolkit"].starSystem.isStarSystem` value is true. It can filter by sector, region, affiliation and travel code, and searches system metadata and world names. Actions open the Toolkit Star System sheet, the existing full-system Scene, or existing planetary overview Scenes. The module never generates or redraws planets and orbits.

## Computer terminal

The terminal indexes only documents the current user can observe: Journal titles and page text, Actors, Computer categories/tags/paths, and Toolkit Star System metadata. Supported commands:

```text
help / помощь / справка / команды
home / главная / домой
clear / очистить
search / поиск / найти <query>
open / открыть <path>
database / база / данные [query]
crew / экипаж [query]
relations / отношения / отношение [query]
comms / связь / сообщения [query]
astrometrics / астрометрика
map / system / карта / система [query]
```

Commands without a query open their corresponding application. Unrecognized Russian or English natural-language input is treated as a search query. Search is Unicode-aware, treats `ё` and `е` as equivalent, and uses a conservative prefix match for common Russian word endings. Search results open the corresponding Computer application; Star Systems open in Astrometrics.

## Development checks

```powershell
npm test
npm run check
```

The checks validate JavaScript syntax, JSON files, manifest paths and the core registry, permissions and Toolkit adapter behavior. Runtime verification is intentionally left to a Foundry v14 world because this repository does not bundle Foundry.
