import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import "../../src/background/command_modules.ts";
import { which_key_table_of_keymap } from "../../src/background/browser_module.ts";
import { compile_config } from "../../src/background/compile.ts";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";
import * as protocol from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_PROTOCOL_VERSION } from "../../src/shared/browser_module_protocol.ts";
import type { ScopeTree, WhichKeyTable } from "../../src/shared/browser_module_protocol.ts";
import { locked_page_command_ids, scope_tree_of } from "../../src/shared/browser_module_scope.ts";
import { empty_config } from "../../src/shared/config/config_load.ts";
import { DEFAULT_KEYMAP } from "../../src/shared/keys/default_keymap.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { COMMANDS_FILE, create_firefox, IME_DISABLED, IME_ENABLED, key_event, source_of } from "./fake_firefox.ts";
import type { FakeEvent } from "./fake_firefox.ts";

const WHICH_KEY_FILE = "desertfox-whichkey.js";
const KEYMAP = compile_config({ config: empty_config(), default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} }).compiled;
const TREE = scope_tree_of(KEYMAP, locked_page_command_ids(registry.list()), (id, args) => {
  const command = registry.get(id);
  const checked = command && check_args(command, args);
  return checked?.ok ? checked.args : undefined;
});
const TABLE = which_key_table_of_keymap(KEYMAP, TREE, (id) => registry.get(id))!;
const COLORS = { bg_core: "#101010", fg_core: "#cdd6f4", primary: "#89b4fa", secondary: "#b4befe" };
const state = (patch: Record<string, unknown> = {}) => ({ v: BROWSER_MODULE_PROTOCOL_VERSION, enabled: true, keys: [], tabs: {}, tree: TREE, which_key: TABLE, bar_theme: { dark: COLORS, light: { ...COLORS, bg_core: "#eff1f5" } }, ...patch });

// The few parts of the chrome DOM the panel builds with. Text goes in as text nodes, and nothing here parses markup.
class FakeElement {
  localName: string;
  className = "";
  title = "";
  text = "";
  children: (FakeElement | string)[] = [];
  parentNode: FakeElement | null = null;
  shadow: FakeElement | undefined;
  shadow_mode: string | undefined;
  adoptedStyleSheets: unknown[] = [];
  attrs = new Map<string, string>();
  style_values = new Map<string, string>();
  style = {
    cssText: "",
    gridTemplateColumns: "",
    setProperty: (name: string, value: string) => void this.style_values.set(name, value),
    removeProperty: (name: string) => void this.style_values.delete(name),
  };
  constructor(local_name: string) {
    this.localName = local_name;
  }
  get textContent(): string {
    return this.text + this.children.map((child) => (typeof child === "string" ? child : child.textContent)).join("");
  }
  set textContent(text: string) {
    this.text = String(text);
    this.children = [];
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  append(...items: (FakeElement | string)[]) {
    for (const item of items) {
      if (typeof item !== "string") {
        item.remove();
        item.parentNode = this;
      }
      this.children.push(item);
    }
  }
  replaceChildren(...items: (FakeElement | string)[]) {
    for (const child of this.children) if (typeof child !== "string") child.parentNode = null;
    this.children = [];
    this.append(...items);
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
  attachShadow({ mode }: { mode: string }) {
    this.shadow = new FakeElement("#shadow");
    this.shadow_mode = mode;
    return this.shadow;
  }
  all(): FakeElement[] {
    return this.children.flatMap((child) => (typeof child === "string" ? [] : [child, ...child.all(), ...(child.shadow ? [child.shadow, ...child.shadow.all()] : [])]));
  }
}

type Core = { module_pending(win: unknown): unknown; shut_down(): void; watch_pending(fn: (win: unknown) => void): () => void };

function make_chrome_window(firefox: ReturnType<typeof create_firefox>, { fail_progress = false, dark = true } = {}) {
  const window = firefox.make_window();
  const root = new FakeElement("html");
  root.setAttribute("windowtype", "navigator:browser");
  const progress_listeners = new Set<{ onLocationChange(progress: unknown, request: unknown, location: unknown, flags: number): void }>();
  Object.assign(window.win.document, { documentElement: root, createElementNS: (_ns: string, tag: string) => new FakeElement(tag), createElement: (tag: string) => new FakeElement(tag) });
  Object.assign(window.win, {
    innerHeight: 800,
    TextEncoder,
    matchMedia: () => ({ matches: dark }),
    CSSStyleSheet: class {
      text = "";
      replaceSync(text: string) {
        this.text = text;
      }
    },
  });
  Object.assign(window.win.gBrowser, {
    addProgressListener: (listener: never) => {
      if (fail_progress) throw new Error("addProgressListener changed");
      progress_listeners.add(listener);
    },
    removeProgressListener: (listener: never) => void progress_listeners.delete(listener),
  });
  window.load();
  const first = window.add_tab();
  const second = window.add_tab();
  let on = first.browser;
  const press = (key: string, patch: Partial<FakeEvent> = {}) => window.press(key_event(key, { target: on, originalTarget: on, ...patch }));
  const type = (...keys: string[]) => keys.map((key) => press(key));
  const on_tab = (tab: typeof first) => {
    on = tab.browser;
    window.select(tab);
    window.fire_tab_select();
  };
  const host = () => root.children.find((child): child is FakeElement => typeof child !== "string" && child.className === "desertfox-whichkey-host");
  const shown = () => {
    const panel = host()?.shadow?.children[0];
    if (!host() || typeof panel !== "object") return undefined;
    const elements = panel.all();
    return {
      title: elements.find((element) => element.className === "chip")?.textContent,
      rows: elements.filter((element) => element.className.startsWith("row ") || element.className === "row").map((row) => row.textContent),
      footer: elements.find((element) => element.className === "footer")?.textContent,
      frame: elements.find((element) => element.className.startsWith("frame"))?.className,
    };
  };
  const load_document = (flags = 0) => {
    first.browser.innerWindowID++;
    for (const listener of [...progress_listeners]) listener.onLocationChange({ isTopLevel: true }, null, null, flags);
  };
  return { window, root, first, second, press, type, on_tab, host, shown, load_document, progress_listeners };
}

function started({ written = state() as unknown, fail_progress = false, dark = true } = {}) {
  const firefox = create_firefox({ extra_files: { [COMMANDS_FILE]: source_of(COMMANDS_FILE), [WHICH_KEY_FILE]: source_of(WHICH_KEY_FILE) } });
  firefox.start_extension();
  const chrome = make_chrome_window(firefox, { fail_progress, dark });
  if (written !== null) firefox.write_state(written);
  const core = firefox.Services.desertfox_browser_module as Core;
  return { firefox, core, ...chrome };
}

const rows_of = (path: string) => TABLE.panels[path]!.rows.map((row) => `${row.keys}➜${row.command}`);

test("a prefix shows its panel after the delay, drawn from the table with the page panel's look", () => {
  const { type, shown, window, host, firefox } = started();
  type("g");
  assert.equal(shown(), undefined, "nothing before the delay");
  window.run_timers();
  assert.deepEqual(shown(), { title: "+Go", rows: rows_of("g"), footer: "ESCclose", frame: "frame square" });
  assert.equal(host()!.shadow_mode, "closed");
  assert.match(host()!.style.cssText, /pointer-events: none/);
  assert.deepEqual(firefox.errors, []);
});

test("the panel takes the theme's colors as checked hex values, by the color scheme, and leaves a bad one to the sheet's default", () => {
  const dark = started({ written: state({ bar_theme: { dark: { ...COLORS, primary: "red; background: url(x)" }, light: COLORS } }) });
  dark.type("g");
  dark.window.run_timers();
  const values = dark.host()!.style_values;
  assert.equal(values.get("--desertfox-bg-core"), "#101010");
  assert.equal(values.get("--desertfox-fg-core"), "#cdd6f4");
  assert.equal(values.has("--desertfox-primary"), false);
  const light = started({ dark: false });
  light.type("g");
  light.window.run_timers();
  assert.equal(light.host()!.style_values.get("--desertfox-bg-core"), "#eff1f5");
  const none = started({ written: state({ bar_theme: undefined }) });
  none.type("g");
  none.window.run_timers();
  assert.equal(none.host()!.style_values.size, 0);
});

test("a panel that is up follows the next prefix key at once, and a leaf hides it", () => {
  const { type, shown, window } = started();
  type("g");
  window.run_timers();
  type("o");
  assert.equal(shown(), undefined, "the next key hides the old panel first");
  window.run_timers();
  assert.deepEqual(shown()?.rows, rows_of("g o"));
  assert.equal(shown()?.title, "+Go » +Open quickmark");
});

test("a leaf, a key that ends no sequence and Escape each hide the panel", () => {
  for (const ending of ["g", "ö", "Escape"]) {
    const { type, shown, window } = started();
    type("g");
    window.run_timers();
    assert.ok(shown(), ending);
    type(ending);
    assert.equal(shown(), undefined, ending);
    window.run_timers();
    assert.equal(shown(), undefined, `${ending}: no panel comes back`);
  }
});

test("a key that arrives during the delay cancels it, so a stale panel never draws", () => {
  const leaf = started();
  leaf.type("g", "g");
  leaf.window.run_timers();
  assert.equal(leaf.shown(), undefined, "gg ran before the delay ended");
  const deeper = started();
  deeper.type("g", "o");
  deeper.window.run_timers();
  assert.deepEqual(deeper.shown()?.rows, rows_of("g o"), "only the newest prefix draws");
});

test("a guard reset hides the panel: a key typed in a field ends the sequence", () => {
  const { type, press, shown, window } = started();
  type("g");
  window.run_timers();
  window.win.windowUtils.IMEStatus = IME_ENABLED;
  press("a");
  assert.equal(shown(), undefined);
  window.win.windowUtils.IMEStatus = IME_DISABLED;
});

test("a tab switch, a load of another document and the window losing the focus each hide the panel and its pending delay", () => {
  const tab = started();
  tab.type("g");
  tab.window.run_timers();
  tab.on_tab(tab.second);
  assert.equal(tab.shown(), undefined, "tab switch");
  const pending_tab = started();
  pending_tab.type("g");
  pending_tab.on_tab(pending_tab.second);
  pending_tab.window.run_timers();
  assert.equal(pending_tab.shown(), undefined, "a tab switch during the delay");

  const load = started();
  load.type("g");
  load.window.run_timers();
  load.load_document(1);
  assert.ok(load.shown(), "a move within the page keeps it");
  load.load_document();
  assert.equal(load.shown(), undefined, "another document");
  const silent = started();
  silent.type("g");
  silent.first.browser.innerWindowID++;
  silent.window.run_timers();
  assert.equal(silent.shown(), undefined, "a document change with no event still draws nothing");

  const blur = started();
  blur.type("g");
  blur.window.run_timers();
  blur.window.fire("deactivate");
  assert.equal(blur.shown(), undefined, "window blur");
});

test("the pref, the toolbar switch and the consent setting turning off mid-panel each hide it", () => {
  const pref = started();
  pref.type("g");
  pref.window.run_timers();
  pref.firefox.set_pref(false);
  assert.equal(pref.shown(), undefined, "pref off");
  const toolbar = started();
  toolbar.type("g");
  toolbar.window.run_timers();
  toolbar.firefox.write_state(state({ enabled: false }));
  assert.equal(toolbar.shown(), undefined, "toolbar switch off");
  const consent = started();
  consent.type("g");
  consent.window.run_timers();
  // The setting turning off removes the state, as the extension's `storage.session.remove` does.
  const extension = consent.firefox.extension!;
  const old_value = extension.bucket.get("desertfox_browser_module_state");
  extension.bucket.delete("desertfox_browser_module_state");
  extension.listeners.forEach((listener) => listener({ desertfox_browser_module_state: { oldValue: old_value } }));
  assert.equal(consent.shown(), undefined, "the state removed");
});

test("a new tree hides the panel, and a rewrite with the same tree and table keeps it", () => {
  const { type, shown, window, firefox } = started();
  type("g");
  window.run_timers();
  firefox.write_state(state({ tabs: { "9": { mode: "normal", live: false } } }));
  assert.ok(shown(), "same tree");
  const tree: ScopeTree = structuredClone(TREE);
  delete tree.children["J"];
  firefox.write_state(state({ tree }));
  assert.equal(shown(), undefined, "a new tree ends the walk and the panel");
});

test("a table change takes effect at the next sequence, read once per sequence", () => {
  const { type, shown, window, firefox } = started();
  type("g");
  window.run_timers();
  const renamed: WhichKeyTable = structuredClone(TABLE);
  renamed.panels["g"]!.title = ["+Elsewhere"];
  firefox.write_state(state({ which_key: renamed }));
  assert.equal(shown()?.title, "+Go");
  type("Escape", "g");
  window.run_timers();
  assert.equal(shown()?.title, "+Elsewhere");
});

test("which-key off, no table, or a prefix with no panel draws nothing and sets no timer", () => {
  for (const written of [state({ which_key: undefined }), state({ which_key: { ...TABLE, delay_ms: 0 } })]) {
    const { type, shown, window } = started({ written });
    type("g");
    assert.equal(window.timer_count(), 0);
    window.run_timers();
    assert.equal(shown(), undefined);
  }
  const counted = started();
  counted.type("5");
  counted.window.run_timers();
  assert.equal(counted.shown(), undefined, "a bare count lists nothing");
});

test("a skipped prefix waits for no delay of its own, as on a page", () => {
  const { type, shown, window } = started({ written: state({ which_key: { ...TABLE, skip: ["g"] } }) });
  type("g");
  window.run_timers();
  assert.equal(shown(), undefined);
  type("o");
  window.run_timers();
  assert.deepEqual(shown()?.rows, rows_of("g o"));
});

test("a hostile table draws nothing, and text never becomes markup", () => {
  const panel = TABLE.panels["g"]!;
  const hostile = [
    { ...TABLE, panels: { g: { ...panel, rows: [{ keys: "a", command: "x‮y" }] } } },
    { ...TABLE, panels: { g: { ...panel, title: ["\u0007"] } } },
    { ...TABLE, panels: { g: { ...panel, rows: [{ keys: "a", command: "x".repeat(61) }] } } },
    { ...TABLE, panels: { g: { ...panel, rows: [{ keys: { toString: "a" }, command: "x" }] } } },
    { ...TABLE, panels: { g: { ...panel, rows: [] } } },
    { ...TABLE, panels: { g: panel, pad: { title: [], rows: Array.from({ length: 80 }, () => ({ keys: "a", command: "x".repeat(60) })) }, more: "x".repeat(10_000_000) } },
    { ...TABLE, delay_ms: "300" },
    { ...TABLE, border: "url(x)" },
    { ...TABLE, panels: JSON.parse(`{"__proto__": ${JSON.stringify(panel)}}`) },
    "x",
  ];
  for (const which_key of hostile) {
    const { type, shown, window, firefox } = started({ written: state({ which_key }) });
    type("g");
    window.run_timers();
    assert.equal(shown(), undefined, JSON.stringify(which_key).slice(0, 80));
    assert.deepEqual(firefox.errors, []);
  }
  const markup = started({ written: state({ which_key: { ...TABLE, panels: { g: { title: ["<b>Go</b>"], rows: [{ keys: "<a>", command: "<img src=x onerror=alert(1)>" }] } } } }) });
  markup.type("g");
  markup.window.run_timers();
  assert.deepEqual(markup.shown()?.rows, ["<a>➜<img src=x onerror=alert(1)>"]);
  assert.equal(markup.shown()?.title, "<b>Go</b>");
  assert.doesNotMatch(source_of(WHICH_KEY_FILE), /innerHTML|outerHTML|insertAdjacentHTML|createContextualFragment|DOMParser|\.href\b|loadURI|fixupAndLoadURIString/);
});

test("the feature sends nothing and writes nothing: the half-typed keys stay in the module", () => {
  const { type, window, firefox } = started();
  const before = [...firefox.extension!.bucket.keys()].sort();
  type("g");
  window.run_timers();
  type("o");
  window.run_timers();
  assert.equal(firefox.read_holder("desertfox_browser_module_from_module"), undefined);
  assert.deepEqual([...firefox.extension!.bucket.keys()].sort(), before);
  assert.doesNotMatch(source_of("sources/whichkey.js"), /core\.send\b|extensionStorageSession\.(set|remove)\b/);
});

test("two windows each draw their own panel, and a reset in one leaves the other", () => {
  const { firefox, type, shown, window } = started();
  const other = make_chrome_window(firefox);
  type("g");
  window.run_timers();
  other.type("g");
  other.window.run_timers();
  assert.ok(shown() && other.shown());
  other.type("Escape");
  assert.equal(other.shown(), undefined);
  assert.ok(shown(), "the first window keeps its panel");
  firefox.set_pref(false);
  assert.equal(shown(), undefined, "a reset of every window hides them all");
});

test("a window that closes with its panel up lets go of the core's watcher and its listeners, with no error", () => {
  const { type, window, firefox, progress_listeners, core } = started();
  const win = vm.runInContext("globalThis", window.win.context!);
  type("g");
  window.close();
  assert.equal(progress_listeners.size, 0);
  assert.equal(window.listener_count("deactivate"), 0);
  window.run_timers();
  firefox.set_pref(false);
  assert.equal(core.module_pending(win), undefined);
  assert.deepEqual(firefox.errors, []);
});

test("a shut down hides the panel", () => {
  const { type, shown, window, core } = started();
  type("g");
  window.run_timers();
  core.shut_down();
  window.run_timers();
  assert.equal(shown(), undefined);
});

test("a shut down during the show delay leaves no panel behind", () => {
  const { type, shown, window, core } = started();
  type("g");
  core.shut_down();
  window.run_timers();
  assert.equal(shown(), undefined);
});

test("a failed start leaves this window without the panel, and the keys still work", () => {
  const { type, shown, window, firefox, first } = started({ fail_progress: true });
  assert.ok(firefox.errors.some((error) => /which-key panel is off in a window: Error: addProgressListener changed/.test(error)), firefox.errors.join("\n"));
  type("g");
  window.run_timers();
  assert.equal(shown(), undefined);
  type("Escape", "x", "p");
  assert.equal(first.browser.stops, 1, "xp still stops the page");
  assert.equal(window.listener_count("deactivate"), 0, "the start undid its listeners");
});

test("a watcher that throws is logged and the key still runs", () => {
  const { type, core, firefox, first } = started();
  core.watch_pending(() => {
    throw new Error("boom");
  });
  type("x", "p");
  assert.equal(first.browser.stops, 1);
  assert.ok(firefox.errors.some((error) => /a watcher of the half-typed keys failed: Error: boom/.test(error)));
});

test("the feature's copy of the names and limits equals src/shared", () => {
  // The source, as the bundle prints a number its own way.
  const source = source_of("sources/whichkey.js");
  const constant = (name: string) => new RegExp(`const ${name} = (\\d+);`).exec(source)?.[1];
  for (const name of ["MAX_WHICH_KEY_BYTES", "MAX_WHICH_KEY_PANELS", "MAX_WHICH_KEY_ROWS", "MAX_WHICH_KEY_TITLE_PARTS", "MAX_WHICH_KEY_LABEL_CHARS", "MAX_WHICH_KEY_SKIP", "MAX_WHICH_KEY_DELAY_MS", "MAX_KEY_CHARS", "MAX_SEQUENCE_KEYS"] as const) assert.equal(constant(name), String(protocol[name]), name);
  assert.equal(new RegExp(`const PROTOCOL_VERSION = (\\d+);`).exec(source)?.[1], String(BROWSER_MODULE_PROTOCOL_VERSION));
  assert.match(source, new RegExp(`const STATE_STORAGE_KEY = "${protocol.BROWSER_MODULE_STATE_STORAGE_KEY}";`));
  assert.deepEqual(JSON.parse(/const WHICH_KEY_BORDERS = (\[[^\]]*\]);/.exec(source)![1]!), protocol.WHICH_KEY_BORDERS);
  const roles = JSON.parse(/const THEME_ROLES = (\[[^\]]*\]);/.exec(source)![1]!) as string[];
  assert.ok(roles.every((role) => (protocol.BAR_ROLES as readonly string[]).includes(role)));
});

test("watch_pending hears each key the taker saw and each reset, with the window or undefined for every window, until it stops", () => {
  const { type, press, core, window, firefox } = started();
  const win = vm.runInContext("globalThis", window.win.context!);
  const heard: unknown[] = [];
  const stop = core.watch_pending((changed) => heard.push(changed === win ? "this window" : changed));
  type("g", "g");
  window.win.windowUtils.IMEStatus = IME_ENABLED;
  press("a");
  window.win.windowUtils.IMEStatus = IME_DISABLED;
  firefox.set_pref(false);
  assert.deepEqual(heard, ["this window", "this window", "this window", undefined]);
  stop();
  firefox.set_pref(true);
  type("g");
  assert.equal(heard.length, 4);
});
