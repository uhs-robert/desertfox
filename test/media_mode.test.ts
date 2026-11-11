// The media mode: its mode state, its keys, and the tab-wide hold in the background.

import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/background/config_load.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import { create_tab_media } from "../src/background/tab_media.ts";
import { create_mode_state, fullscreen_step } from "../src/content/mode_state.ts";
import type { Mode } from "../src/shared/command.ts";
import { MODES } from "../src/shared/command.ts";
import { create_matcher } from "../src/shared/keys/index.ts";
import { check_args } from "../src/shared/registry/index.ts";
import { registry } from "../src/shared/registry/builtin.ts";

test("fullscreen_step: only normal mode enters the media mode, only the media mode leaves with the fullscreen", () => {
  for (const mode of MODES) {
    assert.equal(fullscreen_step(mode, true), mode === "normal" ? "media" : undefined, `enter from ${mode}`);
    assert.equal(fullscreen_step(mode, false), mode === "media" ? "normal" : undefined, `leave from ${mode}`);
  }
});

test("media mode follows the focus into a field and back, as normal mode does", () => {
  const state = create_mode_state();
  state.set_mode_("media");
  state.focus_entered_editable_();
  assert.equal(state.get_mode_(), "insert");
  state.focus_left_editable_();
  assert.equal(state.get_mode_(), "normal");
});

test("Escape ends the media mode, and ignore mode is never left by it", () => {
  const state = create_mode_state();
  state.set_mode_("media");
  state.escape();
  assert.equal(state.get_mode_(), "normal");
  state.set_mode_("ignore");
  state.escape();
  assert.equal(state.get_mode_(), "ignore");
});

test("hint and command line mode return to the mode they began in", () => {
  const state = create_mode_state();
  const from = (start: Mode, via: Mode[]): Mode => {
    state.set_mode_(start);
    for (const mode of via) state.set_mode_(mode);
    state.escape();
    return state.get_mode_();
  };
  assert.equal(from("media", ["hint"]), "media");
  assert.equal(from("media", ["cmdline"]), "media");
  assert.equal(from("normal", ["hint"]), "normal");
  assert.equal(from("normal", ["cmdline"]), "normal");
  // A line opened from a hint (`;:`) belongs to the hint's own start.
  assert.equal(from("media", ["hint", "cmdline"]), "media");
  assert.equal(from("normal", ["hint", "cmdline"]), "normal");
  // Escape from the media mode itself still goes to normal.
  assert.equal(from("media", []), "normal");
});

function compiled() {
  const { compiled, warnings } = compile_config({ config: empty_config(), default_keymap: DEFAULT_KEYMAP, get_command: (id) => registry.get(id), enum_sources: { search_engines: ["site"], containers: [] } });
  assert.deepEqual(warnings, []);
  return compiled;
}

test("the media section holds the media keys and, of normal mode, only f, : and the hint group", () => {
  const media = compiled().modes.media!;
  for (const key of ["F", "h", "l", "0", "^", "$", "%", "H", "L", "j", "k", "<", ">", "=", "m", "<Space>", "p", "q", "r", "i", "<Escape>", "f", ":", ";"]) assert.ok(media.children[key], key);
  const normal = compiled().modes.normal!;
  const shared = Object.keys(media.children).filter((key) => normal.children[key] && JSON.stringify(normal.children[key]) === JSON.stringify(media.children[key]));
  assert.deepEqual(shared.sort(), [":", ";", "<C-[>", "<Escape>", "f"].sort());
  for (const key of ["g", "d", "x", "/", "o", "t", "<C-v>", "G", "n"]) assert.equal(media.children[key], undefined, key);
});

test("the media mode keeps the hint group with its modifiers, and starts at ;M", () => {
  const group = compiled().modes.media!.children[";"];
  assert.equal(group?.kind, "branch");
  const keys = Object.keys((group as { children: object }).children);
  for (const key of ["M", "m", "l", "B", "x"]) assert.ok(keys.includes(key), key);
  const enter = (group as { children: Record<string, { kind: string; steps: { invocation: { args: Record<string, unknown> } }[] }> }).children.M!;
  assert.deepEqual([enter.steps[0]!.invocation.args.action, enter.steps[0]!.invocation.args.filter], ["enter_media", "media"]);
});

test("every media key runs a command that allows the media mode", () => {
  for (const [key, binding] of Object.entries(DEFAULT_KEYMAP.media ?? {})) {
    for (const step of [binding].flat() as { id: string; args?: Record<string, unknown> }[]) {
      const command = registry.get(step.id)!;
      assert.ok(command, key);
      assert.ok((command.modes ?? ["normal"]).includes("media"), `${key} -> ${step.id}`);
    }
  }
  const normal_a = DEFAULT_KEYMAP.normal?.aa as { id: string; args: Record<string, unknown> };
  assert.equal(check_args(registry.get(normal_a.id)!, normal_a.args).ok, true);
});

test("the matcher reads 5l as a count, 0 as the start and 50% as a percent in the media mode", () => {
  const matcher = create_matcher(compiled());
  const leaf_of = (result: ReturnType<typeof matcher.feed>) => (result.kind === "match" ? { count: result.count, action: result.leaf.steps[0]!.invocation.args?.action, value: result.leaf.steps[0]!.invocation.args?.value } : result);
  assert.deepEqual(matcher.feed("media", "5").kind, "pending");
  assert.deepEqual(leaf_of(matcher.feed("media", "l")), { count: 5, action: "seek", value: "up" });
  assert.deepEqual(leaf_of(matcher.feed("media", "0")), { count: undefined, action: "seek", value: "reset" });
  matcher.feed("media", "5");
  matcher.feed("media", "0");
  assert.deepEqual(leaf_of(matcher.feed("media", "%")), { count: 50, action: "seek", value: "percent" });
  // Digits are plain keys outside the counting modes.
  assert.equal(matcher.feed("hint", "5").kind === "pending", false);
});

test("a percent key with no count is refused when it runs, since the count fills the times param", () => {
  const command = registry.get("media.act")!;
  assert.equal(check_args(command, { action: "seek", value: "percent" }).ok, false);
  assert.deepEqual(check_args(command, { action: "seek", value: "percent", times: 50 }), { ok: true, args: { action: "seek", value: "percent", times: 50 } });
});

const LOAD_START = { status: "loading" };

function fake_tab_media() {
  const store = new Map<string, unknown>();
  // `set_mode` media as the mode, and a `MediaStep` as "on" or "off", with "all" for no frame.
  const sent: [number, number | "all", string][] = [];
  const media = create_tab_media({
    storage: {
      get: async (key: string) => (typeof key === "string" && store.has(key) ? { [key]: store.get(key) } : {}),
      set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => store.set(key, value)),
      remove: async (key: string | string[]) => void [key].flat().forEach((name) => store.delete(name)),
    } as never,
    send_mode: async (tab_id, frame_id, mode) => void sent.push([tab_id, frame_id, mode]),
    send_step: async (tab_id, on, frame_id) => void sent.push([tab_id, frame_id ?? "all", on ? "on" : "off"]),
  });
  return { media, sent, store };
}

test("the frame that sees the end reports it, and every other frame of the hold goes to normal, not the reporter", async () => {
  const { media, sent, store } = fake_tab_media();
  await media.enter(7, 0);
  await media.reported(7, 0, "media");
  await media.reported(7, 5, "media");
  assert.deepEqual(sent, [[7, 0, "media"], [7, "all", "on"]]);
  await media.reported(7, 5, "normal");
  assert.deepEqual(sent.slice(2), [[7, 0, "off"]]);
  assert.equal(store.size, 0);
  // A later report of normal from the same frames ends nothing and sends nothing.
  await media.reported(7, 0, "normal");
  assert.equal(sent.length, 3);
});

test("the first frame to report media starts the mode in every frame of the tab, and a frame that joins later sends nothing", async () => {
  const { media, sent } = fake_tab_media();
  await media.reported(4, 3, "media");
  assert.deepEqual(sent, [[4, "all", "on"]]);
  await media.reported(4, 0, "media");
  await media.enter(4, 0);
  assert.deepEqual(sent, [[4, "all", "on"], [4, 0, "media"]]);
});

test("a hint or the command line opened from media keeps the hold, and leaving through insert ends it", async () => {
  const { media, sent } = fake_tab_media();
  await media.reported(3, 0, "media");
  await media.reported(3, 4, "media");
  for (const mode of ["hint", "cmdline", "media"] as const) await media.reported(3, 0, mode);
  assert.deepEqual(sent, [[3, "all", "on"]]);
  await media.reported(3, 0, "insert");
  assert.deepEqual(sent.slice(1), [[3, 4, "off"]]);
});

test("a frame outside the hold, such as a frame that just started, ends nothing", async () => {
  const { media, sent, store } = fake_tab_media();
  await media.reported(3, 0, "media");
  await media.reported(3, 9, "normal");
  await media.reported(3, 9, "insert");
  assert.deepEqual(sent, [[3, "all", "on"]]);
  assert.equal(store.size, 1);
});

test("a report of normal that left before aa's mode arrived does not end the hold that aa began", async () => {
  const { media, sent } = fake_tab_media();
  await media.reported(2, 0, "media");
  await media.reported(2, 3, "media");
  await media.enter(2, 3);
  await media.reported(2, 3, "normal");
  assert.deepEqual(sent.filter(([, , mode]) => mode === "off"), [[2, 0, "off"]]);
});

test("a navigation ends the hold in every frame, and a tab with no hold sends nothing", async () => {
  const { media, sent } = fake_tab_media();
  await media.navigated(5, LOAD_START);
  assert.deepEqual(sent, []);
  await media.reported(5, 0, "media");
  await media.reported(5, 2, "media");
  await media.navigated(5, LOAD_START);
  assert.deepEqual(sent.slice(1).sort(), [[5, 0, "off"], [5, 2, "off"]]);
  await media.navigated(5, LOAD_START);
  assert.equal(sent.length, 3);
});

test("the pin counts only while a frame is in the mode, is dropped by a new start and by the end", async () => {
  const { media } = fake_tab_media();
  await media.pin(8, 3);
  assert.equal(await media.pin_of(8), undefined);
  await media.reported(8, 3, "media");
  assert.equal(await media.pin_of(8), 3);
  await media.enter(8, 0);
  assert.equal(await media.pin_of(8), undefined);
  await media.pin(8, 3);
  assert.equal(await media.pin_of(8), 3);
  await media.reported(8, 3, "normal");
  assert.equal(await media.pin_of(8), undefined);
});

test("the holds of two tabs are apart", async () => {
  const { media, sent } = fake_tab_media();
  await media.reported(1, 0, "media");
  await media.reported(1, 2, "media");
  await media.reported(2, 0, "media");
  await media.reported(2, 0, "normal");
  assert.deepEqual(sent, [[1, "all", "on"], [2, "all", "on"]]);
  await media.reported(1, 0, "normal");
  assert.deepEqual(sent.slice(2), [[1, 2, "off"]]);
});

test("an address change the page makes keeps the hold and drops the pin, and a new document ends it", async () => {
  const { media, sent } = fake_tab_media();
  await media.reported(6, 0, "media");
  await media.reported(6, 2, "media");
  await media.pin(6, 2);
  assert.equal(await media.pin_of(6), 2);
  await media.navigated(6, { url: "https://example.com/next" });
  assert.equal(await media.pin_of(6), undefined);
  // A `replaceState` before the load event comes with the status of the load still under way.
  await media.navigated(6, { status: "loading", url: "https://example.com/again" });
  assert.deepEqual(sent, [[6, "all", "on"]]);
  await media.reported(6, 2, "hint");
  await media.navigated(6, LOAD_START);
  assert.deepEqual(sent.slice(1).sort(), [[6, 0, "off"], [6, 2, "off"]]);
});

test("a fullscreen that ends while hint or the line is open sends the escape to normal", () => {
  const state = create_mode_state();
  state.set_mode_("media");
  state.set_mode_("cmdline");
  state.back_to_normal_();
  state.escape();
  assert.equal(state.get_mode_(), "normal");
});

test("a % binding that gets a wrong other arg is still skipped, while the count stays out of the check", () => {
  const bad = { ...DEFAULT_KEYMAP, media: { "%": { id: "media.act", args: { action: "seek", value: "up", times: 0 } }, X: { id: "media.act", args: { action: "seek", value: "percent", bogus: 1 } } } };
  const { warnings } = compile_config({ config: empty_config(), default_keymap: bad, get_command: (id) => registry.get(id), enum_sources: { search_engines: ["site"], containers: [] } });
  assert.ok(warnings.some((warning) => warning.includes('skipped "X"')), JSON.stringify(warnings));
});

test("a Firefox shortcut that leaves out the count param is skipped, since a shortcut takes no count", () => {
  const with_shortcut = { ...DEFAULT_KEYMAP, browser: { "<A-5>": { id: "media.act", args: { action: "seek", value: "percent" } } } };
  const { warnings } = compile_config({ config: empty_config(), default_keymap: with_shortcut, get_command: (id) => registry.get(id), enum_sources: { search_engines: ["site"], containers: [] } });
  assert.ok(warnings.some((warning) => warning.startsWith('browser: skipped "<A-5>"')), JSON.stringify(warnings));
});
