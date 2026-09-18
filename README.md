# Starfleet Computer

LCARS-style player interface for a Foundry VTT v14 Star Trek Adventures 2e world. It uses Foundry Journals and Actors as canonical content and discovers existing `sta2e-toolkit` Star System Actors and generated Scenes instead of duplicating them.

This release implements SC-01 through SC-05:

- a resizable `ApplicationV2` shell with one instance per client;
- Home, persistent navigation, status, user, world and Toolkit stardate display;
- permission-filtered data services for Journals, Journal pages, Actors, Folders and Scenes;
- Ship Logs, Database, Crew and filesystem-style Files applications;
- persistent Communications with GM authoring, private recipients, unread state and UUID attachments;
- a dedicated `Sta2eToolkitAdapter` for Star System discovery and public Toolkit actions;
- public API for opening the Computer and registering additional applications.

The full Astrometrics browser and Computer Search remain visible in the shell for later SC tasks. Database Star System records and Communication attachments already route through the adapter to the Toolkit record and existing system Scene.

## Install

In Foundry VTT v14, open **Add-on Modules → Install Module**, paste this manifest URL, and install:

```text
https://github.com/kekuskekus/starfleet-computer/releases/latest/download/module.json
```

The module runs on Foundry VTT 13–14 without `sta2e-toolkit`. When Toolkit is installed and active, Astrometrics discovers its Star System Actors and existing generated Scenes. Without Toolkit, the rest of the Computer remains available and Toolkit-dependent controls stay disabled.

## Configure content

Open **Configure Settings → Module Settings → Starfleet Computer**. Enter the Folder ID or Folder UUID for:

- Ship Logs
- Database
- Files
- Communications

The configured Journal folder and all descendant folders are read dynamically. Standard Foundry ownership controls visibility. A player who cannot observe a document will not see it in the Computer. The GM sees all records.

Crew includes permitted character Actors, player-owned Actors, and Actors explicitly marked with `flags["starfleet-computer"].app = "crew"`. Optional display metadata can be stored directly in the module flag namespace:

```json
{
  "flags": {
    "starfleet-computer": {
      "app": "logs",
      "category": "mission",
      "author": "Captain",
      "stardate": "49523.7",
      "terminalPath": "/logs/mission-12",
      "order": 10,
      "role": "Chief Engineer",
      "species": "Human"
    }
  }
}
```

The flags are optional. Source documents remain canonical and are never copied.

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
```

## Development checks

```powershell
npm test
npm run check
```

The checks validate JavaScript syntax, JSON files, manifest paths and the core registry, permissions and Toolkit adapter behavior. Runtime verification is intentionally left to a Foundry v14 world because this repository does not bundle Foundry.
