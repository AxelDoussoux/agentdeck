// Sets the version of the app everywhere it is written: the Cargo workspace
// and its lockfile, package.json and tauri.conf.json.
//
//   pnpm bump 0.2.0
//
// Then commit, and push a `v0.2.0` tag to start the release workflow.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2]?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: pnpm bump <version>, such as pnpm bump 0.2.0");
  process.exit(1);
}

/** Replaces the one match of `pattern` in `file`, or stops if there is none. */
function update(file, pattern, count = 1) {
  const path = join(root, file);
  const text = readFileSync(path, "utf8");
  const found = text.match(new RegExp(pattern, "g"))?.length ?? 0;
  if (found !== count) {
    console.error(`${file}: expected ${count} version to change, found ${found}`);
    process.exit(1);
  }
  writeFileSync(path, text.replace(new RegExp(pattern, "g"), (_, before) => `${before}${version}"`));
  console.log(`${file}: ${version}`);
}

update("Cargo.toml", /(\[workspace\.package\]\nversion = ")[^"]+"/.source);
update("Cargo.lock", /(\nname = "agentdeck-(?:app|cli|core)"\nversion = ")[^"]+"/.source, 3);
update("package.json", /(\n {2}"version": ")[^"]+"/.source);
update("src-tauri/tauri.conf.json", /(\n {2}"version": ")[^"]+"/.source);
