import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { BUNDLE_NAMES } from "../src/shared/bundles.ts";
import type { BundleName } from "../src/shared/bundles.ts";
import "../src/background/command_modules.ts";
import { registry } from "../src/shared/registry/builtin.ts";

// Handler ids a bundle registers for its own use (replies to the content script, drawing and teardown between its parts). None is a registry command, so none runs from a key.
const INTERNAL_IDS: Record<BundleName, string[]> = {
  hints: ["hint.unhover", "heading.list", "heading.clear"],
  caret: ["caret.mode", "find.live", "find.end", "find.clear"],
  whichkey: ["whichkey", "whichkey.draw", "whichkey.erase", "whichkey.media_panel"],
  cmdline: ["cmdline.token", "cmdline.headings", "cmdline.find_status", "cmdline.focus", "cmdline.end", "cmdline.find_text", "cmdline.find_end", "cmdline.headings_ask"],
  ui: ["ui.toast", "ui.frame_watch", "ui.badge_count", "ui.badge"],
  page: [],
  text: ["text.input", "text.flush"],
  editor: [],
  site_actions: [],
  grab: ["grab.mode"],
  item: ["item.start", "item.mark", "item.lists", "item.current", "item.range", "item.cursor"],
  tree: [],
  item_act: [],
  next_page: [],
};

const root = new URL("../", import.meta.url);
const folder_of = (name: BundleName) => (name === "cmdline" ? "src/cmdline" : `src/content/${name}`);

// A bundle's folder is scanned whole, so a helper file that registers a handler counts. cmdline shares src/cmdline with its page, so only its host file counts.
const files_of = (name: BundleName): string[] =>
  name === "cmdline"
    ? ["src/cmdline/host.ts"]
    : readdirSync(new URL(folder_of(name), root), { recursive: true, encoding: "utf8" })
        .filter((path) => path.endsWith(".ts"))
        .map((path) => `${folder_of(name)}/${path}`);

const text_of = (path: string) => readFileSync(new URL(path, root), "utf8");

function registered_ids(name: BundleName): string[] {
  const texts = files_of(name).map(text_of);
  // Handler ids shared with the background live in shared/bundles.ts.
  const constants = new Map([...texts, text_of("src/shared/bundles.ts")].flatMap((text) => [...text.matchAll(/const ([A-Z_]+) = "([^"]+)";/g)].map((match) => [match[1]!, match[2]!] as const)));
  return texts.flatMap((text) =>
    [...text.matchAll(/register_handler_\(\s*(?:"([^"]+)"|([A-Z_]+))/g)].map((match) => {
      const id = match[1] ?? constants.get(match[2]!);
      assert.ok(id, `cannot resolve the handler id ${match[2]}`);
      return id;
    }),
  );
}

test("every handler id a bundle registers is a lazy command of that bundle or on its internal list", () => {
  let total = 0;
  for (const name of BUNDLE_NAMES) {
    const ids = registered_ids(name);
    total += ids.length;
    for (const id of ids) {
      const command = registry.get(id);
      if (command) assert.equal(command.bundle, name, `${id} is registered by ${name} but its registry command names bundle ${command.bundle}`);
      else assert.ok(INTERNAL_IDS[name].includes(id), `${name} registers ${id}, which is no registry command: add it to INTERNAL_IDS or define the command`);
    }
  }
  assert.ok(total > 60, "the handler scan found too few ids");
});

test("an internal id names a handler the bundle registers and is not a registry command", () => {
  for (const name of BUNDLE_NAMES) {
    const ids = registered_ids(name);
    for (const id of INTERNAL_IDS[name]) {
      assert.ok(ids.includes(id), `${name} no longer registers ${id}: remove it from INTERNAL_IDS`);
      assert.equal(registry.get(id), undefined, `${id} is now a registry command: remove it from INTERNAL_IDS`);
    }
  }
});

// The types in bundle_calls.ts are erased, so the map is read as text: each entry names the bundle that registers the id.
const map_entries = [...text_of("src/content/bundle_calls.ts").matchAll(/^ {2}"?([\w.]+)"?: \{ bundle: "(\w+)";/gm)].map((match) => [match[1]!, match[2] as BundleName] as const);

test("every entry of the bundle call map is a handler its bundle registers", () => {
  assert.ok(map_entries.length > 25, "the map scan found too few entries");
  for (const [id, name] of map_entries) assert.ok(registered_ids(name).includes(id), `bundle_calls.ts says ${name} registers ${id}, which it does not`);
});

test("every internal handler id has an entry in the bundle call map", () => {
  const mapped = new Map(map_entries);
  for (const name of BUNDLE_NAMES) for (const id of INTERNAL_IDS[name]) assert.equal(mapped.get(id), name, `${id} is internal to ${name} but has no matching entry in bundle_calls.ts`);
});
