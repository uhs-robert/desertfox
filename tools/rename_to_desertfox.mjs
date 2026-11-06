// Renames the old product name to DesertFox in every text file and path of this repo.
// Run it from the repo root: `node tools/rename_to_desertfox.mjs` to rewrite, `--check` to only count leftovers.
// Rerunning is safe. Other branches run it before they merge.
//
// The old name is spelled from two halves so that this file never matches its own check.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const OLD = "oasis" + "fox";
const NEW = "desert" + "fox";

// Longest pattern first, so the add-on id is handled before the bare word.
// Every pattern contains the old name whole, which is why palettes, `--oasis-*`, `oasis-dots` and `uhs-robert` stay untouched.
const REPLACEMENTS = [
  [`${OLD}@uhs-robert`, `${NEW}@uhs-robert`],
  [OLD.toUpperCase(), NEW.toUpperCase()],
  ["Oasis" + "Fox", "Desert" + "Fox"],
  ["Oasis " + "Fox", "Desert " + "Fox"],
  [OLD, NEW],
];

// Catches the spellings above plus mixed ones with an odd case or separator that no rule rewrites.
const LEFTOVER = /oasis[ _-]?fox/gi;

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });
const git_paths = (...args) => git(...args, "-z").split("\0").filter(Boolean);

// Tracked plus untracked-but-not-ignored, so .git, node_modules, dist and .plans are never visited.
const tracked = new Set(git_paths("ls-files"));
const all_paths = [...new Set([...tracked, ...git_paths("ls-files", "--others", "--exclude-standard")])];

const is_regular_file = (path) => existsSync(path) && lstatSync(path).isFile();
const is_binary = (buffer) => buffer.subarray(0, 8000).includes(0);
const rename_text = (text) => REPLACEMENTS.reduce((acc, [from, to]) => acc.split(from).join(to), text);

function rewrite_contents() {
  const changed = [];
  for (const path of all_paths) {
    if (!is_regular_file(path)) continue;
    const buffer = readFileSync(path);
    if (is_binary(buffer)) continue;
    const before = buffer.toString("utf8");
    const after = rename_text(before);
    if (after === before) continue;
    writeFileSync(path, after);
    changed.push(path);
  }
  return changed;
}

// Renames files and folders by their last segment, deepest first, so a parent path is still valid when its child moves.
function rename_paths() {
  const entries = new Set(all_paths);
  for (const path of all_paths) {
    for (let dir = dirname(path); dir !== "."; dir = dirname(dir)) entries.add(dir);
  }
  const by_depth = [...entries].filter((p) => rename_text(basename(p)) !== basename(p)).sort((a, b) => b.split("/").length - a.split("/").length);
  const moves = [];
  for (const path of by_depth) {
    if (!existsSync(path)) continue;
    const target = join(dirname(path), rename_text(basename(path)));
    if (existsSync(target)) throw new Error(`cannot rename ${path}: ${target} already exists`);
    const is_tracked = tracked.has(path) || [...tracked].some((t) => t.startsWith(path + "/"));
    if (is_tracked) git("mv", path, target);
    else renameSync(path, target);
    moves.push([path, target]);
  }
  return moves;
}

function count_leftovers() {
  const leftovers = [];
  for (const path of all_paths) {
    if (!existsSync(path)) continue;
    const path_hits = path.match(LEFTOVER)?.length ?? 0;
    if (path_hits) leftovers.push({ path, hits: path_hits, where: "path" });
    if (!is_regular_file(path)) continue;
    const buffer = readFileSync(path);
    if (is_binary(buffer)) continue;
    const hits = buffer.toString("utf8").match(LEFTOVER)?.length ?? 0;
    if (hits) leftovers.push({ path, hits, where: "contents" });
  }
  return leftovers;
}

function report_leftovers() {
  const leftovers = count_leftovers();
  const total = leftovers.reduce((sum, l) => sum + l.hits, 0);
  for (const { path, hits, where } of leftovers) console.log(`${hits}\t${where}\t${path}`);
  console.log(`old-name tokens left: ${total} in ${leftovers.length} places`);
  return total;
}

if (process.argv.includes("--check")) {
  process.exit(report_leftovers() === 0 ? 0 : 1);
}

const changed = rewrite_contents();
const moved = rename_paths();
console.log(`rewrote ${changed.length} files, renamed ${moved.length} paths`);
for (const [from, to] of moved) console.log(`  ${from} -> ${to}`);
