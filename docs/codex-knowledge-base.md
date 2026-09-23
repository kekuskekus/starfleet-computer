# Codex knowledge base for Computer

The existing **Computer** terminal can answer questions using a GM-selected Journal
folder. Ordinary Journals remain the canonical knowledge source. Explicit commands
(`search`, `help`, `crew`, `database`, `open`, Russian aliases, and registered extensions)
keep their existing behavior. `ask` / `спроси` explicitly requests an AI answer.

## Requirements

- Foundry VTT 13 or 14, with this version of `starfleet-computer` enabled.
- Node.js 22+ on the GM's computer.
- A recent Codex CLI supporting `exec --ignore-user-config --ignore-rules --ephemeral
  --output-schema` and Streamable HTTP MCP. Tested with `0.155.0-alpha.9.2`.
- Codex signed in with the GM's existing ChatGPT account. Players need neither Node
  nor Codex. No OpenAI API key or API billing settings are used.
- Foundry opened over HTTPS, or on localhost. Browser Web Crypto is required for
  authenticated encrypted module messages. Plain HTTP on a remote IP is unsupported
  for AI; existing local terminal commands continue to work.

Install Codex from the [official CLI instructions](https://developers.openai.com/codex/cli/)
or its official npm package:

```powershell
npm install -g @openai/codex
codex --version
codex login
codex login status
codex exec --help
```

Use the ChatGPT browser sign-in flow. Do not configure an API key. Queries consume
the account's normal Codex allowance. CLI execution is local, but the model is a
hosted Codex model: retrieved excerpts and questions are sent to that service.
This is not an offline model or an entirely local inference system.

## Start the bridge on the GM computer

On Windows you can double-click `start-computer-bridge.cmd`, enter your Foundry
address and keep the console open. It installs the locked dependencies if needed,
finds the installed Codex executable and prints the pairing code.

From the repository/module folder:

```powershell
npm ci
$env:STARFLEET_FOUNDRY_ORIGINS = 'https://your-foundry.example'
npm run bridge
```

Use the exact origin from the Foundry browser address: scheme, hostname and port,
without the world path. For a local installation this may be `http://localhost:30000`.
Multiple explicitly trusted origins may be separated with commas.

The bridge listens on `http://127.0.0.1:32123` and prints a random **local pairing code**.
It does not bind to the LAN or Internet. Keep it running while playing. No Foundry
server modifications, public proxy, or player installations are required.

In **Computer → Computer knowledge** (GM only):

1. Choose the Journal folder from the readable folder paths.
2. Keep the default bridge URL, unless you changed the port.
3. Paste the printed local pairing code and press **Save**.
4. Confirm **Connected** and the expected Journal/page counts.

The pairing code is a local bridge secret, not an OpenAI credential. It is stored
only in that browser's client setting. A blank input preserves the saved code.
The default code changes when the bridge restarts: paste the new code and save.
To keep a stable local code, set a strong `STARFLEET_BRIDGE_TOKEN` in the bridge's
environment. Do not commit it. Clear the selected folder to disable automatic AI.

Optional bridge environment variables:

| Variable | Meaning |
| --- | --- |
| `STARFLEET_BRIDGE_PORT` | Loopback port; default `32123` |
| `STARFLEET_CODEX_BIN` | Executable path if `codex` is not on PATH; on Windows use the actual `.exe` or executable launcher, not a `.cmd` shell string |
| `STARFLEET_CODEX_MODEL` | Optional Codex model override |
| `STARFLEET_BRIDGE_TOKEN` | Optional stable local pairing secret |

The browser must run on the same computer as the bridge. HTTPS-to-loopback requests
may require a browser Local Network Access permission. Allow that permission for
your Foundry site if prompted. Do not disable browser security or expose the bridge
publicly to work around connection problems. Check the browser console for CORS,
mixed-content, or local-network permission errors.

## Knowledge and commands

The corpus includes nonempty text pages, page titles and Journal titles from the
selected folder and all descendant Journal folders. Images, PDFs, video pages,
Actors, Scenes, external links and unrelated Journals are not read. Linked UUIDs
are not automatically expanded. No special markup or separate Markdown database
is required. The GM creates and edits source Journals normally.

The GM builds a fresh corpus before each question, so edits are reflected in the
next question. Source documents and ownership are never modified. Journals may
remain GM-only. Everything placed in the selected folder is potentially answerable:
keep absolutely undisclosable GM notes outside it.

```text
search кардассианцы             → existing local, permission-filtered search
ask Что известно о колонии?     → Codex via the active GM
спроси Сравни даты наблюдений   → Codex via the active GM
Что известно о колонии?         → Codex when a folder is configured
```

Without a configured folder, unknown input retains the original local search.
When AI is unavailable, the terminal shows a short error and local search results.
`clear` clears terminal output and follow-up context and cancels a pending question.
It does not reset configuration or discovery state. The Cancel button stops only
the pending question. Local commands remain available during AI work.

## Architecture and privacy

```text
Player's existing terminal
  → encrypted module socket message
  → one active, bridge-ready GM browser
  → authenticated localhost POST /computer/query (request corpus)
  → isolated codex exec process
  → authenticated request-scoped MCP /mcp
  → bounded knowledge search/read
  → validated answer + source UUIDs to GM
  → encrypted answer only to requesting terminal
```

Ready GM browser sessions advertise ephemeral public keys in their own User flags.
Selection is deterministic by GM user ID then client ID, including multiple tabs
under one GM account. Public-key records are written through Foundry's permission-
checked document API. Keys expire from GM selection after 90 seconds without a
heartbeat; stale records are pruned. Private keys remain in browser memory.

Module sockets are broadcast channels. Both queries and answers are AES-GCM encrypted
using ECDH P-256 session keys; routing metadata is authenticated as additional data.
Other clients may see IDs, timing and ciphertext, but not plaintext questions,
answers, or the corpus. Spoofing sender IDs does not grant the corresponding key.
Foundry server administrators, trusted GMs, and scripts running in the same browser
remain trusted. A compromised Foundry server or malicious browser module is outside
this prototype's protection boundary.

Only the GM execution path extracts the corpus. It sends it directly to loopback,
never through the module socket. The bridge checks Host, Origin and pairing secret,
and accepts one model request at a time. Busy requests fail promptly and may be retried.
The bridge stores corpus snapshots in memory, expires sessions, and removes them in
the request's cleanup path. It does not log or save complete lore, prompts or answers.

Used-source debug records live in a separate **GM-only Journal** named
`Computer — discovery debug`, outside the selected folder. It contains identifiers,
titles and timestamps, not a copy of the knowledge base. Its ID is stored at world
scope. Do not grant players access to this debug Journal. The GM panel lists and
resets the records. Clearing the terminal leaves them intact.

## Codex and MCP configuration

No manual global `codex mcp add` step is needed. For each request the runner uses a
fresh empty temporary working directory, passes the question through stdin, and
supplies these configuration overrides as separate process arguments:

```toml
[mcp_servers.computer]
url = "http://127.0.0.1:32123/mcp"
bearer_token_env_var = "STARFLEET_MCP_SESSION"
required = true
startup_timeout_sec = 15
tool_timeout_sec = 15
```

The runner injects a random per-request MCP token into the child environment.
It is independent of the browser pairing code and cannot access another corpus.
`--ignore-user-config` preserves Codex's existing authentication discovery while
preventing unrelated configured MCP servers from joining the game request.
The runner also disables shell execution, web search, apps, plugins, hooks, skills
search, memories, and multi-agent features, sets a read-only sandbox, and uses
`bridge/computer-instructions.md` with `bridge/answer.schema.json`.
It does not alter the user's normal Codex configuration. Because that configuration
is ignored, any custom model preference must be explicitly provided through
`STARFLEET_CODEX_MODEL`; otherwise the CLI's default is used.

Tools:

- `computer_kb_status`: counts and refresh timestamp, no enumeration.
- `computer_search_knowledge`: bounded lexical search with short excerpts.
- `computer_get_knowledge_page`: bounded text window from an already found page.
- `computer_get_recent_terminal_context`: recent AI conversation only, not lore.
- `computer_record_revealed_sources`: request-local debug recording. Persisted
  discoveries use the validated final response's actual supporting sources.

The initial model prompt never contains the corpus. MCP checks authorization,
request ID, candidate membership and UUID. Unknown or unvisited source identifiers
are discarded. Player answers are rendered as escaped text in the existing terminal.

## Prototype limits

- Question: 2,000 characters. Answer: 6,000 characters.
- Corpus: 2,000 nonempty text pages, 100,000 characters per page,
  4,000,000 serialized characters total; oversized corpora fail visibly.
- Retrieval: at most 3 searches, 5 results per search, 400-character excerpts,
  4 page reads and 18,000 page-read characters per request.
- Long-page reads return a window near the last search hit, at most 6,000 characters,
  explicitly marked truncated. There is no arbitrary pagination or corpus dump tool.
- Follow-ups: at most 8 exchanges and approximately 12,000 characters.
- Codex timeout: 120 seconds; GM/browser deadlines allow a short cleanup margin.
- Corpus TTL: 150 seconds. Discovery history: latest 500 distinct source pages.

Prompt rules and bounded retrieval reduce indiscriminate spoilers; they do not prove
that a model will never hallucinate, infer a spoiler, or gradually reveal information
across many questions. Lexical search can miss synonyms or different languages. The
player may need a more precise question. These are documented prototype limitations,
not a claim of perfect mystery protection.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Disconnected / HTTP 401 | Bridge is running; saved pairing code matches its current code |
| HTTP 403 or CORS error | Exact Foundry origin is in `STARFLEET_FOUNDRY_ORIGINS` |
| Codex login required | `codex login status` under the same Windows/OS user as the bridge |
| CLI exits immediately | Recent supported Codex version and actual executable on PATH |
| No active GM terminal | GM logged in, configured folder, bridge ready, heartbeat published |
| Secure browser context required | Open Foundry over HTTPS or localhost |
| No knowledge / corpus error | Correct Journal folder, text pages, corpus size limits |
| Timeout or unavailable | Account limits, connection, bridge console, retry once current request ends |
| Multiple GM machines | Each candidate GM needs its own bridge and client pairing setting |

Technical failures are logged on the GM side without raw corpus or credentials.
The player receives a generic error and may continue using normal commands.

## Verification

```powershell
npm test
npm run check
```

These use synthetic data, a real local MCP handshake, mocked Codex execution and
encrypted client simulation. They do not consume model usage.

Optional authenticated model integration check (uses normal Codex allowance):

```powershell
npm run bridge:smoke
```

Use `npm run bridge:smoke -- --extended` to also check a broad question, follow-up,
and a request to dump secret records. These checks consume additional Codex usage.

This starts a temporary loopback bridge, sends synthetic Tavos records, verifies
retrieved sources and checks session cleanup. It does not change Foundry documents.

For final in-world acceptance, use a disposable test world with a GM and a player:
select a folder with colony/astronomy/Cardassian pages, ask broad and precise
questions, test a follow-up and a database-dump injection, run local commands,
cancel a pending request, disconnect the bridge, and connect a second GM/tab.
Inspect socket payloads for ciphertext only, and confirm players cannot inspect
source Journals, the debug Journal or GM settings.

References: [Codex noninteractive mode](https://developers.openai.com/codex/noninteractive/),
[Codex configuration](https://developers.openai.com/codex/config-reference/),
[MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).
