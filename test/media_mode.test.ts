// The media mode: its mode state, its keys, and the tab-wide hold in the background.

import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/background/config_load.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import { create_media_discovery, create_tab_media, LINE_CLOSE_GRACE_MS } from "../src/background/tab_media.ts";
import { create_mode_state, fullscreen_step, takes_media_step } from "../src/content/mode_state.ts";
import type { MediaStep } from "../src/shared/messages.ts";
import type { Mode } from "../src/shared/command.ts";
import { MODES } from "../src/shared/command.ts";
import { create_matcher } from "../src/shared/keys/index.ts";
import { panel_after_prefix } from "../src/background/list_keys.ts";
import { mode_label } from "../src/content/ui/mode_label.ts";
import { media_panel_admitted } from "../src/content/whichkey/media_panel.ts";
import { badge_state } from "../src/content/badge_state.ts";
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
  for (const key of ["F", "h", "l", "0", "^", "$", "%", "H", "L", "j", "k", "<", ">", "=", "m", "<Space>", "p", "q", "r", "i", "<Escape>", "f", ":", ";", "?"]) assert.ok(media.children[key], key);
  const normal = compiled().modes.normal!;
  const shared = Object.keys(media.children).filter((key) => normal.children[key] && JSON.stringify(normal.children[key]) === JSON.stringify(media.children[key]));
  assert.deepEqual(shared.sort(), [":", ";", "<A-?>", "<C-[>", "<Escape>", "f"].sort());
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
  const leaf_of = (result: ReturnType<typeof matcher.feed>) => (result.kind_ === "match" ? { count: result.count, action: result.leaf.steps[0]!.invocation.args?.action, value: result.leaf.steps[0]!.invocation.args?.value } : result);
  assert.deepEqual(matcher.feed("media", "5").kind_, "pending");
  assert.deepEqual(leaf_of(matcher.feed("media", "l")), { count: 5, action: "seek", value: "up" });
  assert.deepEqual(leaf_of(matcher.feed("media", "0")), { count: undefined, action: "seek", value: "reset" });
  matcher.feed("media", "5");
  matcher.feed("media", "0");
  assert.deepEqual(leaf_of(matcher.feed("media", "%")), { count: 50, action: "seek", value: "percent" });
  // Digits are plain keys outside the counting modes.
  assert.equal(matcher.feed("hint", "5").kind_ === "pending", false);
});

test("a percent key with no count is refused when it runs, since the count fills the times param", () => {
  const command = registry.get("media.act")!;
  assert.equal(check_args(command, { action: "seek", value: "percent" }).ok, false);
  assert.deepEqual(check_args(command, { action: "seek", value: "percent", times: 50 }), { ok: true, args: { action: "seek", value: "percent", times: 50 } });
});

const LOAD_START = { status: "loading" };

// `store`, `sent` and `clock` passed in from an earlier fake stand for a background that restarted.
function fake_tab_media({ store = new Map<string, unknown>(), sent = [] as [number, number | "all", string][], clock = { now_ms: 0 }, gone = new Set<number>() } = {}) {
  // A `MediaStep` as "on" or "off", with "all" for no frame. `steps` holds each full step the background sent, in order, as the content script receives it.
  const steps: MediaStep[] = [];
  const media = create_tab_media({
    storage: {
      get: async (key: string) => (typeof key === "string" && store.has(key) ? { [key]: store.get(key) } : {}),
      set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => store.set(key, value)),
      remove: async (key: string | string[]) => void [key].flat().forEach((name) => store.delete(name)),
    } as never,
    send_step: async (tab_id, on, frame_id, from) => void (sent.push([tab_id, frame_id ?? "all", on ? "on" : "off"]), steps.push({ type: "media", on, from })),
    frame_alive: async (_tab_id, frame_id) => !gone.has(frame_id),
    now: () => clock.now_ms,
  });
  return { media, sent, store, clock, gone, steps };
}

// `aa` then an immediate Escape: a second step on, sent when the key's frame reports the mode, could reach it after the Escape and put it back in the mode.
test("aa sends the one step on to every frame, and the first report of the mode sends none", async () => {
  const { media, sent } = fake_tab_media();
  await media.enter(7, 0);
  await media.reported(7, 0, "media", false);
  await media.reported(7, 0, "normal", true);
  assert.deepEqual(sent, [[7, "all", "on"]]);
  // The next start, by a fullscreen, steps every frame again.
  await media.reported(7, 0, "media", false);
  assert.deepEqual(sent, [[7, "all", "on"], [7, "all", "on"]]);
});

test("the frame that sees the end reports it, and every other frame of the hold goes to normal, not the reporter", async () => {
  const { media, sent, store } = fake_tab_media();
  await media.enter(7, 0);
  await media.reported(7, 0, "media", false);
  await media.reported(7, 5, "media", false);
  assert.deepEqual(sent, [[7, "all", "on"]]);
  await media.reported(7, 5, "normal", false);
  assert.deepEqual(sent.slice(1), [[7, 0, "off"]]);
  assert.equal(store.size, 0);
  // A later report of normal from the same frames ends nothing and sends nothing.
  await media.reported(7, 0, "normal", false);
  assert.equal(sent.length, 2);
});

test("the first frame to report media starts the mode in every frame of the tab, and a frame that joins later sends nothing", async () => {
  const { media, sent } = fake_tab_media();
  await media.reported(4, 3, "media", false);
  assert.deepEqual(sent, [[4, "all", "on"]]);
  await media.reported(4, 0, "media", false);
  await media.enter(4, 0);
  assert.deepEqual(sent, [[4, "all", "on"], [4, "all", "on"]]);
});

// A site key that starts a fullscreen and ends it at once: the frame is back in normal before the step on that its report caused reaches it.
test("the step on of a first report names the reporter, which skips it and stays in normal, while every other frame takes it", async () => {
  const { media, steps } = fake_tab_media();
  await media.enter(4, 0);
  await media.reported(4, 0, "media", false);
  await media.reported(4, 0, "normal", true);
  await media.reported(4, 3, "media", false);
  assert.equal(steps.length, 2);
  const step = steps[1]!;
  const reporter = create_mode_state();
  if (takes_media_step(step, 3)) reporter.set_mode_(fullscreen_step(reporter.get_mode_(), true) ?? reporter.get_mode_());
  assert.equal(reporter.get_mode_(), "normal");
  const other = create_mode_state();
  if (takes_media_step(step, 0)) other.set_mode_(fullscreen_step(other.get_mode_(), true) ?? other.get_mode_());
  assert.equal(other.get_mode_(), "media");
});

test("a hint or the command line opened from media keeps the hold, and leaving through insert ends it", async () => {
  const { media, sent } = fake_tab_media();
  await media.reported(3, 0, "media", false);
  await media.reported(3, 4, "media", false);
  for (const mode of ["hint", "cmdline", "media"] as const) await media.reported(3, 0, mode, false);
  assert.deepEqual(sent, [[3, "all", "on"]]);
  await media.reported(3, 0, "insert", false);
  assert.deepEqual(sent.slice(1), [[3, 4, "off"]]);
});

test("a frame outside the hold, such as a frame that just started, ends nothing", async () => {
  const { media, sent, store } = fake_tab_media();
  await media.reported(3, 0, "media", false);
  await media.reported(3, 9, "normal", false);
  await media.reported(3, 9, "insert", false);
  assert.deepEqual(sent, [[3, "all", "on"]]);
  assert.equal(store.size, 1);
});

test("a report of normal that left before aa's mode arrived does not end the hold that aa began", async () => {
  const { media, sent } = fake_tab_media();
  await media.reported(2, 0, "media", false);
  await media.reported(2, 3, "media", false);
  await media.enter(2, 3);
  await media.reported(2, 3, "normal", false);
  assert.deepEqual(sent.filter(([, , mode]) => mode === "off"), [[2, 0, "off"]]);
});

test("a navigation ends the hold in every frame, and a tab with no hold sends nothing", async () => {
  const { media, sent } = fake_tab_media();
  await media.navigated(5, LOAD_START);
  assert.deepEqual(sent, []);
  await media.reported(5, 0, "media", false);
  await media.reported(5, 2, "media", false);
  await media.navigated(5, LOAD_START);
  assert.deepEqual(sent.slice(1).sort(), [[5, 0, "off"], [5, 2, "off"]]);
  await media.navigated(5, LOAD_START);
  assert.equal(sent.length, 3);
});

test("the pin counts only while a frame is in the mode, is dropped by a new start and by the end", async () => {
  const { media } = fake_tab_media();
  await media.pin(8, 3);
  assert.equal(await media.pin_of(8), undefined);
  await media.reported(8, 3, "media", false);
  assert.equal(await media.pin_of(8), 3);
  await media.enter(8, 0);
  assert.equal(await media.pin_of(8), undefined);
  await media.pin(8, 3);
  assert.equal(await media.pin_of(8), 3);
  await media.reported(8, 3, "normal", false);
  assert.equal(await media.pin_of(8), undefined);
});

test("the holds of two tabs are apart", async () => {
  const { media, sent } = fake_tab_media();
  await media.reported(1, 0, "media", false);
  await media.reported(1, 2, "media", false);
  await media.reported(2, 0, "media", false);
  await media.reported(2, 0, "normal", false);
  assert.deepEqual(sent, [[1, "all", "on"], [2, "all", "on"]]);
  await media.reported(1, 0, "normal", false);
  assert.deepEqual(sent.slice(2), [[1, 2, "off"]]);
});

test("an address change the page makes keeps the hold and drops the pin, and a new document ends it", async () => {
  const { media, sent } = fake_tab_media();
  await media.reported(6, 0, "media", false);
  await media.reported(6, 2, "media", false);
  await media.pin(6, 2);
  assert.equal(await media.pin_of(6), 2);
  await media.navigated(6, { url: "https://example.com/next" });
  assert.equal(await media.pin_of(6), undefined);
  // A `replaceState` before the load event comes with the status of the load still under way.
  await media.navigated(6, { status: "loading", url: "https://example.com/again" });
  assert.deepEqual(sent, [[6, "all", "on"]]);
  await media.reported(6, 2, "hint", false);
  await media.navigated(6, LOAD_START);
  assert.deepEqual(sent.slice(1).sort(), [[6, 0, "off"], [6, 2, "off"]]);
});

// The player sits in frame 5, the top frame 0 is in the mode too, and the fullscreen ends while frame `line_frame` has a hint or the line open. Each frame of the fullscreen sees the end: the line's frame closes it back to the mode, the others report normal, in any order.
async function framed_hold(line_mode: Mode, line_frame = 5) {
  const fake = fake_tab_media();
  await fake.media.reported(7, 0, "media", false);
  await fake.media.reported(7, 5, "media", false);
  await fake.media.reported(7, line_frame, line_mode, false);
  fake.sent.length = 0;
  return fake;
}

const OTHER_FRAME = { 0: 5, 5: 0 } as const;

for (const line_mode of ["cmdline", "hint"] as const) {
  for (const line_frame of [5, 0] as const) {
    const other = OTHER_FRAME[line_frame];
    test(`${line_mode} in frame ${line_frame}: the other frame reports normal first, keeps the hold and goes back to the mode when the ${line_mode} closes`, async () => {
      const { media, sent, store } = await framed_hold(line_mode, line_frame);
      await media.reported(7, other, "normal", false);
      assert.deepEqual(sent, []);
      await media.reported(7, line_frame, "media", false);
      assert.deepEqual(sent, [[7, other, "on"]]);
      await media.reported(7, other, "media", false);
      assert.deepEqual(sent, [[7, other, "on"]]);
      assert.deepEqual((store.get("desertfox_tab_media_7") as { frames: number[] }).frames, [0, 5]);
    });

    test(`${line_mode} in frame ${line_frame}: the ${line_mode} closes first, and the other frame's normal right after goes back to the mode`, async () => {
      const { media, sent, clock } = await framed_hold(line_mode, line_frame);
      await media.reported(7, line_frame, "media", false);
      clock.now_ms += 200;
      await media.reported(7, other, "normal", false);
      assert.deepEqual(sent, [[7, other, "on"]]);
    });
  }
}

test("a normal report long after a line closed back to the mode ends the hold, as a plain Escape does", async () => {
  const { media, sent, clock } = await framed_hold("cmdline");
  await media.reported(7, 5, "media", false);
  clock.now_ms += LINE_CLOSE_GRACE_MS;
  await media.reported(7, 0, "normal", false);
  assert.deepEqual(sent, [[7, 5, "off"]]);
});

test("an Escape in another frame right after a line closed ends the hold, because that frame holds the focus", async () => {
  const { media, sent, clock } = await framed_hold("cmdline");
  await media.reported(7, 5, "media", false);
  clock.now_ms += 50;
  await media.reported(7, 0, "normal", true);
  assert.deepEqual(sent, [[7, 5, "off"]]);
});

test("the line's own frame leaving the mode ends the hold, and the frame that left meanwhile gets the step off too", async () => {
  const { media, sent, store } = await framed_hold("cmdline");
  await media.reported(7, 0, "normal", false);
  await media.reported(7, 0, "normal", false);
  // The frame's own `mode.set normal`, or its new document after a navigation, reports normal.
  await media.reported(7, 5, "normal", false);
  assert.deepEqual(sent, [[7, 0, "off"]]);
  assert.equal(store.size, 0);
});

test("a frame removed while its line is open keeps nothing, so a normal report ends the hold", async () => {
  const { media, sent, gone } = await framed_hold("cmdline");
  gone.add(5);
  await media.reported(7, 0, "normal", false);
  assert.deepEqual(sent, [[7, 5, "off"]]);
});

test("a line frame removed while another line is open does not keep the frames that left out of the mode when that line closes", async () => {
  const { media, sent, gone } = fake_tab_media();
  for (const frame_id of [0, 3, 5]) await media.reported(7, frame_id, "media", false);
  await media.reported(7, 3, "hint", false);
  await media.reported(7, 5, "cmdline", false);
  sent.length = 0;
  gone.add(3);
  await media.reported(7, 0, "normal", false);
  await media.reported(7, 5, "media", false);
  assert.deepEqual(sent, [[7, 0, "on"]]);
});

test("every frame of a nested fullscreen that leaves goes back, before and after the line closes", async () => {
  const { media, sent, clock } = fake_tab_media();
  for (const frame_id of [0, 3, 5]) await media.reported(7, frame_id, "media", false);
  await media.reported(7, 5, "cmdline", false);
  sent.length = 0;
  await media.reported(7, 0, "normal", false);
  await media.reported(7, 5, "media", false);
  clock.now_ms += 300;
  await media.reported(7, 3, "normal", false);
  assert.deepEqual(sent, [[7, 0, "on"], [7, 3, "on"]]);
});

test("a background that restarts between the reports still keeps the hold", async () => {
  const first = await framed_hold("cmdline");
  await first.media.reported(7, 0, "normal", false);
  const { media, sent } = fake_tab_media({ store: first.store, sent: first.sent, clock: first.clock });
  await media.reported(7, 5, "media", false);
  assert.deepEqual(sent, [[7, 0, "on"]]);
});

test("a pin and an address change keep the open line", async () => {
  const { media, sent } = await framed_hold("hint");
  await media.pin(7, 5);
  await media.navigated(7, { url: "https://example.com/next" });
  await media.reported(7, 0, "normal", false);
  await media.reported(7, 5, "media", false);
  assert.deepEqual(sent, [[7, 0, "on"]]);
});

test("a media mode that ends in another frame while hint or the line is open sends the escape to normal", () => {
  const state = create_mode_state();
  state.set_mode_("media");
  state.set_mode_("cmdline");
  assert.equal(state.media_ended_(false), undefined);
  state.escape();
  assert.equal(state.get_mode_(), "normal");
});

test("a fullscreen that ends in this frame closes a line opened from media mode to media mode", () => {
  for (const line of ["cmdline", "hint"] as const) {
    const state = create_mode_state();
    state.set_mode_("media");
    state.set_mode_(line);
    assert.equal(state.media_ended_(true), "media", line);
    state.set_mode_("media");
    assert.equal(state.get_mode_(), "media");
    assert.equal(state.media_ended_(true), "normal");
  }
});

test("a line opened from normal mode ignores a fullscreen that ends, and the media mode ends with it", () => {
  const state = create_mode_state();
  state.set_mode_("cmdline");
  assert.equal(state.media_ended_(true), undefined);
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

test("? in the media mode runs help.whichkey", () => {
  const leaf = compiled().modes.media!.children["?"] as { steps: { invocation: { id: string } }[] };
  assert.equal(leaf.steps[0]!.invocation.id, "help.whichkey");
});

test("the media panel lists the media keys, and the badge says MEDIA", () => {
  const rows = panel_after_prefix(compiled().modes.media, [], (id) => registry.get(id)).rows;
  for (const key of ["?", "F", "h", "l", "m"]) assert.ok(rows.some((row) => row.keys === key), key);
  assert.equal(mode_label("media", false, "always"), "MEDIA");
  assert.equal(mode_label("media", false, "not_normal"), "MEDIA");
  assert.deepEqual(badge_state("media", false, "always", undefined), { mode: "media", pass_next: false, setting: "always", recording: undefined, site_label: undefined });
  assert.equal(badge_state("media", false, "off", undefined), undefined);
});

function session_store() {
  const store = new Map<string, unknown>();
  return {
    store,
    storage: {
      get: async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {}),
      set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => store.set(key, value)),
      remove: async (key: string | string[]) => void [key].flat().forEach((name) => store.delete(name)),
    } as never,
  };
}

function discovery(options: { delay_ms?: number; storage?: ReturnType<typeof session_store>; open_tabs?: Set<number> } = {}) {
  const opened: number[] = [];
  const closed: number[] = [];
  const stored = options.storage ?? session_store();
  const discover = create_media_discovery({
    storage: stored.storage,
    which_key_delay_ms: async () => options.delay_ms ?? 300,
    tab_is_open: async (tab_id) => options.open_tabs?.has(tab_id) ?? true,
    open_panel: async (tab_id) => void opened.push(tab_id),
    close_panel: async (tab_id) => void closed.push(tab_id),
  });
  return { discover, opened, closed, store: stored.store };
}

test("the panel opens when the top frame enters the media mode", async () => {
  const { discover, opened } = discovery();
  await discover.reported(7, 0, "media");
  assert.deepEqual(opened, [7]);
});

test("the panel does not open for a child frame, another mode or a delay of 0", async () => {
  for (const [name, test_case, frame_id, mode] of [
    ["child frame", discovery(), 3, "media"],
    ["normal mode", discovery(), 0, "normal"],
    ["hint mode", discovery(), 0, "hint"],
    ["delay 0", discovery({ delay_ms: 0 }), 0, "media"],
  ] as const) {
    await test_case.discover.reported(7, frame_id, mode);
    assert.deepEqual(test_case.opened, [], name);
  }
});

test("a repeated media report from the top frame (a refocus) opens nothing, a return from a hint or the line does", async () => {
  const { discover, opened } = discovery();
  await discover.reported(7, 0, "media");
  await discover.reported(7, 0, "media");
  assert.deepEqual(opened, [7]);
  await discover.reported(7, 0, "hint");
  await discover.reported(7, 0, "media");
  await discover.reported(7, 0, "cmdline");
  await discover.reported(7, 0, "media");
  assert.deepEqual(opened, [7, 7, 7]);
  await discover.reported(7, 0, "normal");
  await discover.reported(7, 0, "media");
  assert.equal(opened.length, 4);
});

test("a restarted background does not take a focus report for an entry", async () => {
  const stored = session_store();
  await discovery({ storage: stored }).discover.reported(7, 0, "media");
  const after_restart = discovery({ storage: stored });
  await after_restart.discover.reported(7, 0, "media");
  assert.deepEqual(after_restart.opened, []);
});

test("a child frame's report does not count as the top frame leaving media", async () => {
  const { discover, opened } = discovery();
  await discover.reported(7, 0, "media");
  await discover.reported(7, 2, "normal");
  await discover.reported(7, 0, "media");
  assert.deepEqual(opened, [7]);
});

function gated_discovery() {
  const opened: number[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const discover = create_media_discovery({
    storage: session_store().storage,
    which_key_delay_ms: async () => (await gate, 300),
    tab_is_open: async () => true,
    open_panel: async (tab_id) => void opened.push(tab_id),
    close_panel: async () => undefined,
  });
  return { discover, opened, release };
}

test("a panel is not opened when the mode changed while the checks were pending", async () => {
  const { discover, opened, release } = gated_discovery();
  const pending = discover.reported(7, 0, "media");
  await discover.reported(7, 0, "normal");
  release();
  await pending;
  assert.deepEqual(opened, []);
});

test("a repeat media report while the checks are pending does not drop the open", async () => {
  const { discover, opened, release } = gated_discovery();
  const pending = discover.reported(7, 0, "media");
  await discover.reported(7, 0, "media");
  release();
  await pending;
  assert.deepEqual(opened, [7]);
});

test("forget clears the tab, and a report that lands after the close stores nothing", async () => {
  const open_tabs = new Set([7]);
  const { discover, store } = discovery({ open_tabs });
  await discover.reported(7, 0, "media");
  assert.equal(store.size, 1);
  open_tabs.delete(7);
  await discover.forget(7);
  assert.equal(store.size, 0);
  await discover.reported(7, 0, "media");
  assert.equal(store.size, 0);
});

test("the frame draws the panel only while it is in media mode and not in full screen", () => {
  for (const mode of MODES) {
    assert.equal(media_panel_admitted(mode, false), mode === "media", mode);
    assert.equal(media_panel_admitted(mode, true), false, `${mode} in full screen`);
  }
});

test("a key that runs in a child frame in media mode closes the panel of the top frame, and no other key does", async () => {
  const { discover, closed } = discovery();
  await discover.key_ran(7, 3, "media");
  await discover.key_ran(7, 3, "media");
  assert.deepEqual(closed, [7, 7]);
  await discover.key_ran(7, 0, "media");
  await discover.key_ran(7, 3, "normal");
  assert.deepEqual(closed, [7, 7]);
});

const hold_frames = (store: Map<string, unknown>): number[] | undefined => [...store.values()].map((hold) => (hold as { frames: number[] }).frames)[0];

test("join: a frame that starts while frames are in the mode, or after aa, joins it and is written into the hold in the same turn", async () => {
  const frames_in = fake_tab_media();
  await frames_in.media.reported(7, 0, "media", false);
  assert.equal(await frames_in.media.join(7, 3), true);
  assert.deepEqual(hold_frames(frames_in.store), [0, 3]);
  const after_aa = fake_tab_media();
  await after_aa.media.enter(7, 0);
  assert.equal(await after_aa.media.join(7, 3), true);
  assert.deepEqual(hold_frames(after_aa.store), [3]);
});

test("join: a pin with no frame in the mode, no hold, an ended hold and a new load do not join", async () => {
  const pinned = fake_tab_media();
  await pinned.media.pin(7, 2);
  assert.equal(await pinned.media.join(7, 3), false);
  assert.deepEqual(hold_frames(pinned.store), []);
  assert.equal(await fake_tab_media().media.join(7, 3), false);
  const ended = fake_tab_media();
  await ended.media.enter(7, 0);
  await ended.media.reported(7, 0, "media", false);
  await ended.media.reported(7, 0, "normal", true);
  assert.equal(await ended.media.join(7, 3), false);
  const loaded = fake_tab_media();
  await loaded.media.enter(7, 0);
  await loaded.media.navigated(7, { status: "loading" });
  assert.equal(await loaded.media.join(7, 3), false);
});

test("join: a hold that ends after the join sends the joined frame the step off, and the hold is gone", async () => {
  const { media, sent, store } = fake_tab_media();
  await media.enter(7, 0);
  await media.reported(7, 0, "media", false);
  await media.join(7, 3);
  await media.reported(7, 0, "normal", true);
  assert.deepEqual(sent, [[7, "all", "on"], [7, 3, "off"]]);
  assert.equal(store.size, 0);
});

test("join: the joined frame's own report sends no second step on", async () => {
  const { media, sent } = fake_tab_media();
  await media.enter(7, 0);
  await media.reported(7, 0, "media", false);
  await media.join(7, 3);
  await media.reported(7, 3, "media", false);
  assert.deepEqual(sent, [[7, "all", "on"]]);
});

test("join: two frames joining together are both kept", async () => {
  const { media, store } = fake_tab_media();
  await media.enter(7, 0);
  assert.deepEqual(await Promise.all([media.join(7, 3), media.join(7, 4)]), [true, true]);
  assert.deepEqual(hold_frames(store), [3, 4]);
});

// Issue 527. A frame's report of the mode says whether a step or a join reply caused it (`by_step`). Such a report found no hold when the hold had ended before the frame took the step, and started a new one whose step on put every other frame back in the mode.
test("a site key that enters and leaves fullscreen in one frame: the second frame's late report starts nothing and goes back to normal", async () => {
  const { media, sent, store } = fake_tab_media();
  await media.reported(7, 5, "media", false);
  await media.reported(7, 5, "normal", true);
  await media.reported(7, 0, "media", false, true);
  assert.deepEqual(sent, [[7, "all", "on"], [7, 0, "off"]]);
  assert.equal(store.size, 0);
});

test("aa then a fast Escape in the key's frame: a frame that takes aa's step late starts nothing and goes back to normal", async () => {
  const { media, sent, store } = fake_tab_media();
  await media.enter(7, 0);
  await media.reported(7, 0, "media", false, true);
  await media.reported(7, 0, "normal", true);
  await media.reported(7, 4, "media", false, true);
  assert.deepEqual(sent, [[7, "all", "on"], [7, 4, "off"]]);
  assert.equal(store.size, 0);
});

// The top frame sees the fullscreen of its child frame as its own, so it enters and leaves by itself, and the step of the child's report can reach it after it left.
test("an ancestor frame that takes the step after its own fullscreen ended starts nothing and goes back to normal", async () => {
  const { media, sent, store } = fake_tab_media();
  await media.reported(7, 5, "media", false);
  await media.reported(7, 0, "media", false);
  await media.reported(7, 5, "normal", true);
  await media.reported(7, 0, "normal", false);
  await media.reported(7, 0, "media", false, true);
  assert.deepEqual(sent, [[7, "all", "on"], [7, 0, "off"], [7, 0, "off"]]);
  assert.equal(store.size, 0);
});

test("join: a frame that missed the step off before it applied the join reply starts nothing and goes back to normal", async () => {
  const { media, sent, store } = fake_tab_media();
  await media.enter(7, 0);
  assert.equal(await media.join(7, 9), true);
  await media.reported(7, 0, "media", false, true);
  await media.reported(7, 0, "normal", true);
  await media.reported(7, 9, "media", false, true);
  assert.deepEqual(sent, [[7, "all", "on"], [7, 9, "off"], [7, 9, "off"]]);
  assert.equal(store.size, 0);
});

test("a real fullscreen in the second frame after a late step still starts the mode in every frame", async () => {
  const { media, sent } = fake_tab_media();
  await media.reported(7, 5, "media", false);
  await media.reported(7, 5, "normal", true);
  await media.reported(7, 0, "media", false, true);
  await media.reported(7, 0, "normal", false);
  await media.reported(7, 0, "media", false);
  assert.deepEqual(sent.at(-1), [7, "all", "on"]);
  await media.reported(7, 5, "media", false, true);
  await media.reported(7, 5, "normal", false);
  assert.deepEqual(sent.at(-1), [7, 0, "off"]);
});

test("a late step's report joins a live hold, even one that started after the step, and its end sends that frame the step off", async () => {
  const { media, sent } = fake_tab_media();
  await media.reported(7, 5, "media", false);
  await media.reported(7, 5, "normal", true);
  await media.reported(7, 5, "media", false);
  await media.reported(7, 0, "media", false, true);
  assert.equal(sent.length, 2);
  await media.reported(7, 5, "normal", true);
  assert.deepEqual(sent.at(-1), [7, 0, "off"]);
});

// A pin alone is no live hold: joining it would leave the ;M frame's first report without its step on.
test("a late step's report with only a pin stored leaves the ;M frame's step on to every frame", async () => {
  const { media, sent } = fake_tab_media();
  await media.pin(7, 3);
  await media.reported(7, 0, "media", false, true);
  assert.deepEqual(sent, [[7, 0, "off"]]);
  await media.reported(7, 3, "media", false);
  assert.deepEqual(sent.at(-1), [7, "all", "on"]);
  assert.equal(await media.pin_of(7), 3);
});
