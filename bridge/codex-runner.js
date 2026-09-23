import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { KB_LIMITS } from "../scripts/services/computerKnowledgeProtocol.js";

const schema = fileURLToPath(new URL("./answer.schema.json", import.meta.url));
const instructions = fileURLToPath(new URL("./computer-instructions.md", import.meta.url));

export function codexArguments({ cwd, mcpUrl, model }) {
  const args = ["exec", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--skip-git-repo-check",
    "--sandbox", "read-only", "--cd", cwd, "--output-schema", schema, "--json"];
  const options = { approval_policy: "never", web_search: "disabled", project_doc_max_bytes: 0,
    model_instructions_file: instructions, "mcp_servers.computer.url": mcpUrl,
    "mcp_servers.computer.bearer_token_env_var": "STARFLEET_MCP_SESSION", "mcp_servers.computer.required": true,
    "mcp_servers.computer.startup_timeout_sec": 15, "mcp_servers.computer.tool_timeout_sec": 15 };
  for (const feature of ["shell_tool", "unified_exec", "apps", "plugins", "remote_plugin", "hooks", "memories",
    "multi_agent", "browser_use", "computer_use", "view_image", "image_generation", "skill_search", "workspace_dependencies"]) {
    options[`features.${feature}`] = false;
  }
  for (const [key, value] of Object.entries(options)) args.push("-c", `${key}=${JSON.stringify(value)}`);
  if (model) args.push("--model", model);
  args.push("-");
  return args;
}

function stopProcess(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", shell: false });
    killer.on("error", () => child.kill());
    killer.on("close", code => { if (code !== 0) child.kill(); });
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}

export async function runCodex({ requestId, question, token, mcpUrl, signal,
  executable = process.env.STARFLEET_CODEX_BIN || "codex", model = process.env.STARFLEET_CODEX_MODEL,
  timeout = KB_LIMITS.timeout, spawnProcess = spawn }) {
  const cwd = await mkdtemp(join(tmpdir(), "starfleet-computer-"));
  try {
    if (signal?.aborted) throw new Error("Request cancelled");
    return await new Promise((resolve, reject) => {
      // Preserve ChatGPT login discovery; do not inherit API credentials or nested-agent context.
      const env = { ...process.env, STARFLEET_MCP_SESSION: token };
      for (const key of Object.keys(env)) if (/^(OPENAI_API_KEY|CODEX_API_KEY|CODEX_THREAD_ID|CODEX_INTERNAL_|CODEX_SANDBOX)/.test(key)) delete env[key];
      const child = spawnProcess(executable, codexArguments({ cwd, mcpUrl, model }),
        { cwd, env, shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
      let buffer = "", answer = null, size = 0, failure = null;
      const fail = message => { failure ??= new Error(message); stopProcess(child); };
      const abort = () => fail("Request cancelled");
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => fail("Codex timed out"), timeout);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
      child.on("error", error => { cleanup(); reject(error); });
      child.stdout.on("data", chunk => {
        size += chunk.length;
        if (size > 2_000_000) return fail("Codex output limit exceeded");
        buffer += chunk.toString();
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          try {
            const event = JSON.parse(line);
            if (event.type === "item.completed" && event.item?.type === "agent_message") answer = event.item.text;
            if (event.type === "turn.failed" || event.type === "error") failure = new Error("Codex execution failed; check login and account limits");
          } catch { /* Ignore non-JSON diagnostic lines, never expose them to players. */ }
        }
      });
      // Drain diagnostics without persisting corpus or authentication details.
      child.stderr.on("data", () => {});
      child.stdin.on("error", () => {});
      child.on("close", code => {
        cleanup();
        if (failure || code !== 0) return reject(failure ?? new Error(`Codex exited with code ${code}`));
        try { resolve(JSON.parse(answer)); } catch { reject(new Error("Codex did not return a structured answer")); }
      });
      child.stdin.end(JSON.stringify({ requestId, playerQuestion: question,
        task: "Answer this one question using the computer MCP tools. Retrieve recent context only if needed." }));
    });
  } finally { await rm(cwd, { recursive: true, force: true }); }
}

export async function checkCodex(executable = process.env.STARFLEET_CODEX_BIN || "codex") {
  // Checking CLI/login is free of model requests and never exposes login output.
  const command = args => new Promise(resolve => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(() => { stopProcess(child); resolve(false); }, 5000);
    child.on("error", () => { clearTimeout(timer); resolve(false); });
    child.on("close", code => { clearTimeout(timer); resolve(code === 0); });
  });
  return { installed: await command(["--version"]), authenticated: await command(["login", "status"]) };
}
