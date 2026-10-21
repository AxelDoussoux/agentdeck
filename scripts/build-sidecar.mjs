// Builds the `agentdeck` CLI and puts it where Tauri expects the sidecar:
// src-tauri/binaries/agentdeck-<target triple>[.exe]. The app bundles it next
// to its own executable, so "Move to keychain" works without installing the
// CLI separately.
//
// Tauri runs this before `tauri dev` and `tauri build`, and sets
// TAURI_ENV_TARGET_TRIPLE and TAURI_ENV_DEBUG. Run it by hand
// (`pnpm sidecar`) before a plain `cargo build` of the app.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const host = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/^host: (\S+)$/m)[1];
const target = process.env.TAURI_ENV_TARGET_TRIPLE || host;
const release = process.env.TAURI_ENV_DEBUG !== "true" && !process.argv.includes("--debug");

const args = ["build", "-p", "agentdeck-cli", "--locked"];
if (release) args.push("--release");
if (target !== host) args.push("--target", target);
execFileSync("cargo", args, { cwd: root, stdio: "inherit" });

const ext = target.includes("windows") ? ".exe" : "";
const profile = release ? "release" : "debug";
const built = join(root, "target", ...(target !== host ? [target] : []), profile, `agentdeck${ext}`);
const dest = join(root, "src-tauri", "binaries", `agentdeck-${target}${ext}`);
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(built, dest);
console.log(`sidecar: ${dest}`);
