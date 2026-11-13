import assert from "node:assert/strict";
import { test } from "node:test";

test("the hints bundle registers a hint sink and hint.run, and registers once", async () => {
  const registered: string[] = [];
  const handlers = new Map<string, (args: Record<string, unknown>) => void>();
  const sinks = new Map<string, { on_token_: (token: string) => string; exit: () => void }>();
  const modes: string[] = [];
  const host = {
    register_sink_: (mode: string, sink: never) => void sinks.set(mode, sink),
    register_handler_: (id: string, handler: never) => {
      registered.push(id);
      handlers.set(id, handler);
    },
    set_mode_: (mode: string) => void modes.push(mode),
    escape_: () => void modes.push("normal"),
  };
  (globalThis as Record<string, unknown>).window = { desertfox_host: host };
  const message_listeners: unknown[] = [];
  (globalThis as Record<string, unknown>).browser = { runtime: { onMessage: { addListener: (listener: unknown) => void message_listeners.push(listener) } } };
  const bundle_url = new URL("../../src/content/hints/main.ts", import.meta.url).href;
  await import(`${bundle_url}?first`);
  await import(`${bundle_url}?second`);
  assert.deepEqual(registered, ["page.follow", "page.focus_field", "page.heading", "copy.links", "hint.unhover", "hint.key", "heading.list", "heading.go", "heading.clear", "hint.run"]);
  assert.deepEqual([...sinks.keys()], ["hint"]);
  assert.equal(message_listeners.length, 1);
  assert.deepEqual(modes, []);
  assert.equal(sinks.get("hint")!.on_token_("a"), "pass");
  // With no session the keys go on to the page and the keymap, whatever they mean in hint mode.
  for (const token of ["/", "<Tab>", "<S-Tab>", "<Enter>", "<Space>"]) assert.equal(sinks.get("hint")!.on_token_(token), "pass", token);
  sinks.get("hint")!.exit();
});

test("a bundle that runs before the content script's host waits for the host, so a later load still registers", async () => {
  const registered: string[] = [];
  const page: Record<string, unknown> = {};
  (globalThis as Record<string, unknown>).window = page;
  (globalThis as Record<string, unknown>).browser = { runtime: { onMessage: { addListener: () => {} } } };
  const bundle_url = new URL("../../src/content/hints/main.ts", import.meta.url).href;
  await import(`${bundle_url}?no_host`);
  assert.equal(page.desertfox_hints_ready, undefined);
  page.desertfox_host = { register_sink_: () => {}, register_handler_: (id: string) => void registered.push(id), set_mode_: () => {}, escape_: () => {} };
  await import(`${bundle_url}?with_host`);
  assert.equal(page.desertfox_hints_ready, true);
  assert.ok(registered.includes("hint.run"));
});

// A hint session in a bare document: `frames=all_frames` starts one with nothing to label, and a background that never answers the start keeps the session open while the frame waits.
let loads = 0;
async function with_session(opened_from: "normal" | "media") {
  const { create_mode_state } = await import("../../src/content/mode_state.ts");
  const state = create_mode_state(opened_from);
  const exits: string[] = [];
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
  const sinks = new Map<string, { exit: (next: string) => void }>();
  const navigation = new EventTarget();
  const host = {
    register_sink_: (mode: string, sink: never) => void sinks.set(mode, sink),
    register_handler_: (id: string, handler: never) => void handlers.set(id, handler),
    hold_keys_until_: () => {},
    set_mode_: (mode: string) => {
      const left = state.get_mode_();
      state.set_mode_(mode as never);
      if (left === "hint" && mode !== "hint") sinks.get("hint")!.exit(mode);
    },
    escape_: () => {
      const left = state.get_mode_();
      state.escape();
      if (left === "hint") exits.push(state.get_mode_());
      if (left === "hint") sinks.get("hint")!.exit(state.get_mode_());
    },
  };
  const page: Record<string, unknown> = { desertfox_host: host, navigation, location: { href: "https://app.test/a" }, document: { hidden: false, querySelectorAll: () => [], compatMode: "CSS1Compat", documentElement: { clientWidth: 100, clientHeight: 50 }, body: null, defaultView: { innerWidth: 100, innerHeight: 50 } }, performance: { now: () => 1 }, addEventListener: () => {}, setTimeout, clearTimeout };
  page.top = page;
  const globals = globalThis as Record<string, unknown>;
  globals.window = page;
  globals.document = page.document;
  globals.browser = { runtime: { onMessage: { addListener: () => {} }, sendMessage: (message: { type: string }) => (message.type === "hint_frames_start" ? new Promise(() => {}) : Promise.resolve(undefined)) }, storage: { local: { get: async () => ({}) } } };
  await import(`${new URL("../../src/content/hints/main.ts", import.meta.url).href}?session_${loads++}`);
  const commit = (type: string | null) => navigation.dispatchEvent(Object.assign(new Event("currententrychange"), { navigationType: type }));
  const open = async () => {
    state.set_mode_("hint");
    void handlers.get("hint.run")!({ action: "click", filter: "links", frames: "all_frames" });
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  return { state, exits, commit, open };
}

test("a pushState that commits ends the hint session once and returns to normal mode", async () => {
  const { state, exits, commit, open } = await with_session("normal");
  await open();
  commit("push");
  assert.deepEqual(exits, ["normal"]);
  assert.equal(state.get_mode_(), "normal");
  commit("push");
  assert.deepEqual(exits, ["normal"], "a second change finds no session");
});

test("a replace or a change with no navigation leaves the hint session on", async () => {
  const { state, commit, open } = await with_session("normal");
  await open();
  commit("replace");
  commit(null);
  assert.equal(state.get_mode_(), "hint");
});

test("a session opened from media mode returns to media mode on a committed pushState", async () => {
  const { state, commit, open } = await with_session("media");
  await open();
  assert.equal(state.get_mode_(), "hint");
  commit("push");
  assert.equal(state.get_mode_(), "media");
});
