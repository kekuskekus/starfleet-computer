import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function walk(directory) {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    if (name === "node_modules" || name === ".git") return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(root);
for (const file of files.filter(path => path.endsWith(".js") || path.endsWith(".mjs"))) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}

for (const file of files.filter(path => path.endsWith(".json"))) JSON.parse(readFileSync(file, "utf8"));

const manifest = JSON.parse(readFileSync(join(root, "module.json"), "utf8"));
for (const path of [...manifest.esmodules, ...manifest.styles, ...manifest.languages.map(language => language.path)]) {
  if (!existsSync(join(root, path))) throw new Error(`Manifest path does not exist: ${path}`);
}

console.log(`Validated ${files.length} files in ${relative(process.cwd(), root) || "."}`);
