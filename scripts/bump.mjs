// Version bump across all four release files — replaces the old sed pipeline,
// whose Cargo.lock edit targeted a HARDCODED LINE NUMBER (silently wrong the
// moment the lockfile shifted). Usage:
//   node scripts/bump.mjs           -> bump patch (0.7.77 -> 0.7.78)
//   node scripts/bump.mjs 0.8.0     -> set an explicit version
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const p = (f) => join(root, f);

const pkgPath = p("package.json");
const confPath = p("src-tauri/tauri.conf.json");
const tomlPath = p("src-tauri/Cargo.toml");
const lockPath = p("src-tauri/Cargo.lock");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const cur = pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(cur)) throw new Error(`package.json version "${cur}" is not x.y.z`);

let next = process.argv[2];
if (!next) {
  const [maj, min, pat] = cur.split(".").map(Number);
  next = `${maj}.${min}.${pat + 1}`;
}
if (!/^\d+\.\d+\.\d+$/.test(next)) throw new Error(`target version "${next}" is not x.y.z`);

// package.json — reserialize (2-space, trailing newline, matches repo style).
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// tauri.conf.json — targeted string replace to keep untouched formatting stable.
const conf = readFileSync(confPath, "utf8");
const confNext = conf.replace(`"version": "${cur}"`, `"version": "${next}"`);
if (confNext === conf) throw new Error(`tauri.conf.json: "version": "${cur}" not found`);
writeFileSync(confPath, confNext);

// Cargo.toml — the first `version = "..."` (the [package] header block).
const toml = readFileSync(tomlPath, "utf8");
const tomlNext = toml.replace(`version = "${cur}"`, `version = "${next}"`);
if (tomlNext === toml) throw new Error(`Cargo.toml: version = "${cur}" not found`);
writeFileSync(tomlPath, tomlNext);

// Cargo.lock — locate the wte-app package BLOCK and patch its version line,
// wherever it lives (never a line number).
const lock = readFileSync(lockPath, "utf8");
const block = /(\[\[package\]\]\s*\nname = "wte-app"\s*\nversion = ")([^"]+)(")/;
if (!block.test(lock)) throw new Error("Cargo.lock: [[package]] wte-app block not found");
writeFileSync(lockPath, lock.replace(block, `$1${next}$3`));

console.log(`bumped ${cur} -> ${next} (package.json, tauri.conf.json, Cargo.toml, Cargo.lock)`);
