// A handler must never refuse an argument value that the param schema accepts: every static rule lives in the schema.
// For each background command, the test builds args the one validator accepts, runs the real handler against a stub
// `browser`, and fails on any throw that is not a RuntimeRefusal.
import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import type { CommandContext, ParamDef } from "../../src/shared/command.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import type { EnumSources } from "../../src/shared/registry/check_args.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { is_dynamic_values, static_values } from "../../src/shared/registry/params.ts";

// Handlers that throw a TypeError on the stub whatever the args, each with the reason. Empty now: every background handler runs through. Nothing else may throw a TypeError.
const CANNOT_RUN_ON_STUB: Record<string, string> = {};

// One text each setting accepts. A name missing here gets "x", which the validator may drop.
const VALID_SETTING_TEXT: Record<string, string> = { which_key_delay_ms: "500", hint_letters: "asdf", next_patterns: "a.com b.com", light_intensity: "4", home_page: "https://example.org", default_engine: "stub", palette: "stub", cmdline_prompt: ">", history_completion_max: "5", history_list_max: "5", newtab_bookmarks_max: "5", newtab_recent_tabs_max: "5", newtab_clock: "digital", newtab_clock_format: "24", open_completion: "bookmarks", which_key_border: "round", mode_indicator: "off", new_tab_page: "desertfox" };

// Refusals a handler may give on the stub, from its state or the config and not from an argument value: no sound playing, no
// container, bookmark or home page, a tab that cannot unload, nothing to repeat. A refusal that matches no entry fails, so a
// handler that starts refusing accepted args shows up. An entry that never matches fails too.
const EXPECTED_REFUSALS: Record<string, RegExp[]> = {
  "tab.goto_audible": [/no tab is playing sound/],
  "tab.switch": [/matches .* equally, use a number/],
  "tab.move": [/matches .* equally/],
  "tab.unload": [/matches .* equally/, /unloaded 0 tabs/],
  "tab.load": [/matches .* equally/, /loaded 0 tabs/],
  "tab.reopen_in_container": [/No container named/],
  "tab.attach": [/already in that window/],
  "bookmark.open": [/no bookmark matches/],
  "history.open": [/no history entry matches/],
  "bookmark.remove": [/no bookmark matches/, /No bookmark for this page/],
  "bookmark.rename": [/no bookmark matches/, /No bookmark for this page/],
  "bookmark.edit_url": [/no bookmark matches/, /No bookmark for this page/],
  "page.home": [/set home_page in settings.toml/],
  "open.url": [/No container named/],
  "open.search": [/No search engine named/],
  "open.clipboard": [/No container named/],
  "session.open": [/No session named/],
  "session.delete": [/No session named/],
  "session.rename": [/No session named/],
  "command.repeat": [/Nothing to repeat/],
  "url.increment": [/has no number/],
  "register.list": [/is empty/],
};

const SOURCES: EnumSources = { search_engines: ["stub_engine"], containers: ["stub_container"] };
const CTX: CommandContext = { tab_id: 1, window_id: 1, frame_id: 0, mode: "normal" };

const STUB_TAB = { id: 1, windowId: 1, index: 0, active: true, pinned: false, audible: false, discarded: false, incognito: false, status: "complete", url: "https://example.org/a", title: "A", cookieStoreId: "firefox-default", lastAccessed: 3, mutedInfo: { muted: false } };
const STUB_TABS = [STUB_TAB, { ...STUB_TAB, id: 2, index: 1, active: false, url: "https://example.org/b", title: "B", lastAccessed: 2 }, { ...STUB_TAB, id: 3, index: 2, active: false, title: "C", lastAccessed: 1 }];
const STUB_WINDOWS = [
  { id: 1, type: "normal", incognito: false, focused: true, tabs: STUB_TABS },
  { id: 2, type: "normal", incognito: false, focused: false, tabs: [{ ...STUB_TAB, id: 4, windowId: 2 }] },
];
const STUB_CLOSED = [{ tab: { ...STUB_TAB, sessionId: "s1" } }, { window: { sessionId: "s2" } }];
const STUB_MARK = { id: "b1", title: "Mark", url: "https://example.org/m", type: "bookmark" };

// What each browser call answers. A call that is not listed answers undefined.
const STUB_ANSWERS: Record<string, unknown> = {
  "tabs.query": STUB_TABS,
  "tabs.get": STUB_TAB,
  "tabs.update": STUB_TAB,
  "tabs.create": STUB_TAB,
  "tabs.duplicate": STUB_TAB,
  "tabs.move": [STUB_TAB],
  "tabs.getZoom": 1,
  "tabs.executeScript": [null],
  "windows.getAll": STUB_WINDOWS,
  "windows.get": STUB_WINDOWS[0],
  "windows.create": STUB_WINDOWS[0],
  "windows.update": STUB_WINDOWS[0],
  "sessions.getRecentlyClosed": STUB_CLOSED,
  "bookmarks.search": [STUB_MARK],
  "bookmarks.getTree": [{ id: "root", title: "", children: [STUB_MARK] }],
  "bookmarks.create": STUB_MARK,
  "history.search": [],
  "contextualIdentities.query": [{ name: "stub_container", cookieStoreId: "firefox-container-1", color: "blue", icon: "circle" }],
  "permissions.contains": true,
  "storage.session.get": {},
  "storage.local.get": {},
  "runtime.getURL": "moz-extension://stub/home.html",
  "runtime.sendNativeMessage": { ok: true, config_dir: "/stub/desertfox", config_dir_exists: true, files: {} },
};

// A `browser` whose calls answer from STUB_ANSWERS, so a handler runs past its first browser call into its own checks.
function stub_browser(): unknown {
  const namespace = (path: string): unknown =>
    new Proxy(function () {}, {
      get: (_target, key) => (typeof key === "symbol" || key === "then" ? undefined : key === "id" ? "stub@desertfox" : namespace(`${path}${path === "" ? "" : "."}${key}`)),
      apply: () => (path.startsWith("runtime.getURL") ? STUB_ANSWERS["runtime.getURL"] : Promise.resolve(STUB_ANSWERS[path])),
    });
  return namespace("");
}

function candidates(param: ParamDef): readonly unknown[] {
  switch (param.type) {
    case "int":
      return [-1, 0, 1, 2];
    case "float":
      return [-1, 0, 1, 1.5];
    case "bool":
      return [false, true];
    case "enum":
      return static_values(param) ?? (is_dynamic_values(param.values) ? (SOURCES[param.values.from] ?? ["x"]) : ["x"]);
    case "key":
      return ["", "a", "Z", "1", "x"];
    case "string":
      // A named register is empty on the stub, which is a runtime refusal of its own and would hide what the other params do.
      if (param.name === "register") return [""];
      return ["", " ", "1", "x", "1 x", ...(static_values(param) ?? []).slice(0, 2), ...(static_values(param) ?? []).slice(-1)];
  }
}

// The base args leave every param out, then each param takes each candidate alone. A set the validator rejects is dropped.
function accepted_args(command: NonNullable<ReturnType<typeof registry.get>>): Record<string, unknown>[] {
  const params = command.params ?? [];
  const sets: Record<string, unknown>[] = [{}];
  for (const param of params) for (const value of candidates(param)) sets.push({ [param.name]: value });
  const required = Object.fromEntries(params.map((param) => [param.name, candidates(param).at(-1)]));
  sets.push(required);
  // A value that the named setting accepts, so a handler's parse branch runs. One-param-at-a-time sets leave `value` empty.
  const value_param = params.find((param) => param.value_of !== undefined);
  if (value_param) for (const name of static_values(params.find((param) => param.name === value_param.value_of)!) ?? []) sets.push({ [value_param.value_of as string]: name, [value_param.name]: VALID_SETTING_TEXT[name] ?? "x" });
  return sets.filter((args) => check_args(command, args, SOURCES).ok).map((args) => (check_args(command, args, SOURCES) as { args: Record<string, unknown> }).args);
}

test("no background handler refuses args the schema accepts", async () => {
  (globalThis as unknown as { browser: unknown }).browser = stub_browser();
  Object.defineProperty(globalThis.navigator, "clipboard", { value: { readText: async () => "stub text" }, configurable: true });
  const failures: string[] = [];
  const stuck = new Set<string>();
  const used = new Set<string>();
  try {
    for (const command of registry.list()) {
      if (command.runs_in !== "background") continue;
      for (const args of accepted_args(command)) {
        try {
          await Promise.race([Promise.resolve(command.run!(CTX, args)), new Promise((resolve) => setTimeout(resolve, 200))]);
        } catch (error) {
          if ((error as Error).name === "RuntimeRefusal") {
            const index = (EXPECTED_REFUSALS[command.id] ?? []).findIndex((pattern) => pattern.test((error as Error).message));
            if (index >= 0) used.add(`${command.id}#${index}`);
            else failures.push(`${command.id} ${JSON.stringify(args)}: unexpected refusal: ${(error as Error).message}`);
            continue;
          }
          if (error instanceof TypeError && Object.hasOwn(CANNOT_RUN_ON_STUB, command.id)) {
            stuck.add(command.id);
            continue;
          }
          failures.push(`${command.id} ${JSON.stringify(args)}: ${(error as Error).name}: ${(error as Error).message}`);
        }
      }
    }
  } finally {
    delete (globalThis as unknown as { browser?: unknown }).browser;
    delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
  }
  assert.deepEqual(failures, []);
  // An entry that no longer gets stuck is stale, so the list stays honest.
  const stale_refusals = Object.entries(EXPECTED_REFUSALS).flatMap(([id, patterns]) => patterns.map((_, index) => `${id}#${index}`)).filter((key) => !used.has(key));
  assert.deepEqual(stale_refusals, []);
  assert.deepEqual(Object.keys(CANNOT_RUN_ON_STUB).filter((id) => !stuck.has(id)), []);
});
