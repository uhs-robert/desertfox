import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { build } from "esbuild";
import { release_options } from "../support/metafile.ts";
import { BROWSER_MODULE_PROTOCOL_VERSION as V, MAX_KIND_BYTES } from "../../src/shared/browser_module_protocol.ts";
import type { SnapshotPart } from "../../src/shared/browser_module_protocol.ts";
import { CONFIG_STATUS_STORAGE_KEY } from "../../src/shared/storage_watch.ts";
import { THEME_STORAGE_KEY } from "../../src/shared/theme/apply.ts";
import { keymap_snapshot_of, page_keymap_for } from "../../src/background/page_keymap.ts";
import { compile_keymap } from "../../src/shared/keys/index.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../../src/shared/prefix_tree.ts";
import type { CompiledKeymap } from "../../src/shared/prefix_tree.ts";

// The shipped bundle, run as the browser module runs it: in a fresh global that holds only the transport.
const bundle = (await build(release_options({ locked_shim: "src/content/locked_shim.ts" }))).outputFiles[0]!.text;

type Shimmed = {
  runtime: {
    id: string | undefined;
    getURL: (path: string) => string;
    getFrameId: () => number;
    sendMessage: (message: unknown) => Promise<unknown>;
    onMessage: { addListener: (listener: (...args: never[]) => unknown) => void; removeListener: (listener: (...args: never[]) => unknown) => void };
  };
  storage: { local: { get: (keys: unknown) => Promise<Record<string, unknown>> }; onChanged: { addListener: (listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void) => void } };
};

function load(snapshots: Partial<Record<SnapshotPart, unknown>> = {}) {
  const state = { alive: true, calls: [] as string[], bundles: [] as string[], load_answer: { ok: true } as unknown, answer: (_text: string): Promise<string> => Promise.resolve(JSON.stringify({ value: "ok" })) };
  let push: ((message: string) => Promise<string>) | undefined;
  let snapshot_changed: ((part: SnapshotPart) => void) | undefined;
  const transport = {
    extension_id: "desertfox@uhs-robert",
    base_url: "moz-extension://abc/",
    alive: () => state.alive,
    call: (text: string) => {
      state.calls.push(text);
      return state.answer(text);
    },
    load_bundle: async (name: string) => {
      state.bundles.push(name);
      return state.load_answer;
    },
    snapshot: (part: SnapshotPart) => snapshots[part],
    on_snapshot: (listener: (part: SnapshotPart) => void) => void (snapshot_changed = listener),
    on_push: (listener: (message: string) => Promise<string>) => void (push = listener),
  };
  const context = vm.createContext({ desertfox_locked_transport: transport, TextEncoder });
  vm.runInContext(bundle, context);
  const scope = context as { browser?: Shimmed; desertfox_locked_transport?: unknown };
  assert.equal(scope.desertfox_locked_transport, undefined, "the shim takes the transport off the global");
  return { browser: scope.browser!, state, snapshots, push: (text: string) => push!(text), changed: (part: SnapshotPart) => snapshot_changed!(part) };
}

const snap = (value: unknown) => ({ v: V, value });

const resolve = () => ({ runs_in: "content" as const, label: "x", count: "ignore" as const });
const KEYMAP = { normal: { j: { id: "a.j" }, k: { id: "a.k" }, q: { id: "macro.record" }, ",i": { id: "a.i" } }, browser: {} };
const SITE_RULES = [{ site: "https://pass.test/*", pass: "j" }, { site: "https://off.test/*", off: true }, { site: "https://only.test/*", only: "k" }, { site: "https://bind.test/*", bind: { j: { id: "a.bound" } } }];
const stored_keymap = compile_keymap(KEYMAP as never, { site_rules: SITE_RULES } as never, resolve).compiled as CompiledKeymap;
const keymap_snapshot = snap(JSON.parse(JSON.stringify(keymap_snapshot_of(stored_keymap))));
// What the background's `read_keymap_state` answers for a locked tab.
const state_of = (state: Record<string, unknown>) => async () => JSON.stringify({ value: state });
const storage_of = (keymap: CompiledKeymap) => ({ get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: keymap }) }) as never;
// Values made in the shim's global have that global's prototypes.
const plain = (value: unknown): unknown => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

test("a background message goes out as JSON text and its answer comes back", async () => {
  const { browser, state } = load();
  state.answer = async (text) => JSON.stringify({ value: { echoed: JSON.parse(text) as unknown } });
  assert.deepEqual(plain(await browser.runtime.sendMessage({ type: "register_read", name: "a" })), { echoed: { type: "register_read", name: "a" } });
  assert.deepEqual(state.calls, ['{"type":"register_read","name":"a"}']);
  state.answer = async () => JSON.stringify({});
  assert.equal(await browser.runtime.sendMessage({ type: "record_timing", name: "x", ms: 1 }), undefined, "no answer");
  state.answer = async () => JSON.stringify({ error: "handler failed" });
  await assert.rejects(browser.runtime.sendMessage({ type: "run", invocations: [], mode: "normal" }), /handler failed/);
  state.answer = async () => "not json";
  await assert.rejects(browser.runtime.sendMessage({ type: "run", invocations: [], mode: "normal" }), /not JSON/);
  state.answer = async () => "[1]";
  await assert.rejects(browser.runtime.sendMessage({ type: "run", invocations: [], mode: "normal" }), /not a table/);
  state.answer = () => Promise.reject(new Error("the module lost the call"));
  await assert.rejects(browser.runtime.sendMessage({ type: "run", invocations: [], mode: "normal" }), /lost the call/);
});

test("a refused, unknown, page-only or junk type never reaches the transport", async () => {
  const { browser, state } = load();
  for (const message of [{ type: "snippet_run", name: "x" }, { type: "inspect_pick" }, { type: "quality_probe", address: "x" }, { type: "change_setting" }, { type: "eval" }, { type: "__proto__" }, { type: 5 }, {}, null, "run", [{ type: "run" }]]) {
    await assert.rejects(browser.runtime.sendMessage(message), /not sent from a locked page/, JSON.stringify(message));
  }
  assert.deepEqual(state.calls, []);
});

test("a message too large for its kind is refused here, before the transport", async () => {
  const { browser, state } = load();
  await assert.rejects(browser.runtime.sendMessage({ type: "hint_frames_start", texts: ["t".repeat(MAX_KIND_BYTES)] }), /too large/);
  assert.deepEqual(state.calls, []);
});

test("read_keymap and the root which-key panel come from their snapshots, a bundle load from the module", async () => {
  const panel = { title: [], rows: [{ keys: "j", command: "scroll", description: "", more: false }], border: "square" };
  const { browser, state, snapshots } = load({ keymap: keymap_snapshot, which_key: snap(panel) });
  state.answer = state_of({ address: "https://example.test/" });
  assert.ok(JSON.parse((await browser.runtime.sendMessage({ type: "read_keymap", join: true, url: "about:addons" })) as string).keymap.modes.normal);
  state.calls.length = 0;
  assert.deepEqual(await browser.runtime.sendMessage({ type: "list_keys", mode: "normal", prefix: [], url: "about:addons" }), panel);
  assert.deepEqual(state.calls, []);
  await browser.runtime.sendMessage({ type: "list_keys", mode: "normal", prefix: ["g"], url: "about:addons" });
  assert.equal(state.calls.length, 1, "a prefix panel is a call");
  assert.deepEqual(plain(await browser.runtime.sendMessage({ type: "load_bundle", name: "hints" })), { ok: true });
  assert.deepEqual(state.bundles, ["hints"]);
  snapshots.which_key = undefined;
  await browser.runtime.sendMessage({ type: "list_keys", mode: "normal", prefix: [], url: "" });
  assert.equal(state.calls.length, 2, "no root snapshot, so the panel is a call");
});

const ask = async (browser: Shimmed, extra: Record<string, unknown> = {}) => {
  const text = (await browser.runtime.sendMessage({ type: "read_keymap", join: true, url: "https://page.says/", ...extra })) as string | undefined;
  return text === undefined ? undefined : (JSON.parse(text) as { all_off: boolean; recording?: string; join?: string; keymap: { bar?: boolean; mode_indicator?: string; modes: { normal: { children: Record<string, unknown> } } } });
};

test("read_keymap resolves the snapshot's site rules for the address the background names and asks for the state with the join flag only", async () => {
  const { browser, state } = load({ keymap: keymap_snapshot });
  state.answer = state_of({ address: "https://pass.test/a" });
  assert.equal((await ask(browser))!.keymap.modes.normal.children["j"], undefined, "pass");
  state.answer = state_of({ address: "https://off.test/a" });
  assert.equal((await ask(browser))!.all_off, true, "off");
  state.answer = state_of({ address: "https://only.test/a" });
  assert.deepEqual(Object.keys((await ask(browser))!.keymap.modes.normal.children).includes("j"), false, "only");
  state.answer = state_of({ address: "https://bind.test/a" });
  assert.equal(JSON.stringify((await ask(browser))!.keymap.modes.normal.children["j"]).includes("a.bound"), true, "bind");
  state.answer = state_of({ address: "https://example.test/" });
  const plain = (await ask(browser))!;
  assert.equal(plain.all_off, false);
  assert.ok(plain.keymap.modes.normal.children["j"]);
  assert.deepEqual(state.calls.slice(-1), ['{"type":"read_keymap_state","join":true}'], "the page's own url is not sent");
  assert.equal(JSON.stringify((await ask(browser, { join: false }))).length > 0, true);
  assert.equal(state.calls.slice(-1)[0], '{"type":"read_keymap_state","join":false}');
});

test("an address the page names is ignored: the background's address decides", async () => {
  const { browser, state } = load({ keymap: keymap_snapshot });
  state.answer = state_of({ address: "https://example.test/" });
  assert.equal((await ask(browser, { url: "https://off.test/a", address: "https://off.test/a" }))!.all_off, false);
});

// An empty tree would leave the page with no keys, so a state the shim cannot use stops the page code as a missing keymap does.
test("a state that fails, is missing or is malformed, or a row the resolver cannot read, stops the page code", async () => {
  const broken_row = JSON.parse(JSON.stringify(stored_keymap)) as { site_rules: { keymap?: unknown }[] };
  broken_row.site_rules[0]!.keymap = { visual: null };
  const cases: { answer: () => Promise<string>; keymap?: unknown }[] = [
    { answer: state_of({}) },
    { answer: state_of({ address: 5 }) },
    { answer: state_of({ address: { href: "https://off.test/a" } }) },
    { answer: async () => JSON.stringify({}) },
    { answer: async () => JSON.stringify({ error: "the page went away" }) },
    { answer: () => Promise.reject(new Error("the module lost the call")) },
    { answer: state_of({ address: "https://pass.test/a" }), keymap: snap(broken_row) },
  ];
  for (const { answer, keymap } of cases) {
    const { browser, state } = load({ keymap: keymap ?? keymap_snapshot });
    state.answer = answer;
    assert.equal(await ask(browser), undefined);
    assert.equal(browser.runtime.id, undefined, "the page code sees the extension gone");
    await assert.rejects(browser.runtime.sendMessage({ type: "register_read", name: "a" }), /invalidated/);
  }
});

test("recording, the insert join and the bar flag pass through; other joins and junk do not", async () => {
  const { browser, state } = load({ keymap: keymap_snapshot });
  state.answer = state_of({ address: "https://example.test/", recording: "a", join: "insert", bar: true });
  const reply = (await ask(browser))!;
  assert.equal(reply.recording, "a");
  assert.equal(reply.join, "insert");
  assert.deepEqual([reply.keymap.bar, reply.keymap.mode_indicator], [true, "off"]);
  for (const [join, recording, bar] of [["media", 5, "yes"], ["item", {}, 1], [{}, [], null]]) {
    state.answer = state_of({ address: "https://example.test/", join, recording, bar });
    const junk = (await ask(browser))!;
    assert.deepEqual([junk.join, junk.recording, junk.keymap.bar], [undefined, undefined, undefined], JSON.stringify([join, recording, bar]));
  }
});

test("the shim's answer equals page_keymap_for for the same inputs", async () => {
  const { browser, state } = load({ keymap: keymap_snapshot });
  for (const address of ["https://example.test/", "https://pass.test/a", "https://off.test/a", "https://only.test/a", "https://bind.test/a"]) {
    for (const extra of [{}, { recording: "a" }, { join: "insert" as const }, { bar: true }, { recording: "b", join: "insert" as const, bar: true }]) {
      state.answer = state_of({ address, ...extra });
      const expected = await page_keymap_for(storage_of(stored_keymap), [address], extra.recording, async () => extra.join, extra.bar);
      assert.deepEqual(await ask(browser), plain(expected), JSON.stringify([address, extra]));
    }
  }
});

// Without a keymap the page code would run with no keys. The shim stops it, as when the extension unloads, so the module's own keys stay in use.
test("a keymap snapshot that is missing, over its cap or of the wrong shape stops the page code and asks nothing", async () => {
  const wrong = JSON.parse(JSON.stringify(stored_keymap)) as Record<string, unknown>;
  const cases: unknown[] = [undefined, { v: V }, { v: V + 1, value: wrong }, snap("text"), snap([1]), snap(null), snap({ ...wrong, modes: 5 }), snap({ ...wrong, modes: [] }), snap({ ...wrong, format_version: (wrong.format_version as number) + 1 })];
  for (const bad of cases) {
    const { browser, state } = load({ keymap: bad });
    state.answer = state_of({ address: "https://example.test/" });
    assert.ok(browser.runtime.id !== undefined, "alive until the first ask");
    assert.equal(await ask(browser), undefined, JSON.stringify(bad)?.slice(0, 50));
    assert.equal(browser.runtime.id, undefined, "the page code sees the extension gone");
    await assert.rejects(browser.runtime.sendMessage({ type: "register_read", name: "a" }), /invalidated/);
    assert.deepEqual(state.calls, []);
  }
});

test("tree_updated makes the page ask again, and the new answer reads the new snapshot and state", async () => {
  const { browser, state, snapshots, changed } = load({ keymap: keymap_snapshot });
  let updates = 0;
  browser.runtime.onMessage.addListener(((message: { type?: string }) => void (message.type === "tree_updated" && updates++)) as never);
  state.answer = state_of({ address: "https://example.test/" });
  assert.equal((await ask(browser))!.recording, undefined);
  state.answer = state_of({ address: "https://example.test/", recording: "a" });
  snapshots.keymap = snap({ ...JSON.parse(JSON.stringify(stored_keymap)), item_navigator: true });
  changed("keymap");
  assert.equal(updates, 1);
  assert.equal((await ask(browser))!.recording, "a");
  assert.equal(state.calls.length, 2);
});

test("storage.local serves the config status and the theme from snapshots and refuses every other key", async () => {
  const status = { settings: { hint_chars: "asdf" } };
  const theme = { dark: { bg: "#000" }, light: { bg: "#fff" } };
  const { browser, snapshots } = load({ config: snap(status), theme: snap(theme) });
  assert.deepEqual(plain(await browser.storage.local.get(CONFIG_STATUS_STORAGE_KEY)), { [CONFIG_STATUS_STORAGE_KEY]: status });
  assert.deepEqual(plain(await browser.storage.local.get([CONFIG_STATUS_STORAGE_KEY, THEME_STORAGE_KEY])), { [CONFIG_STATUS_STORAGE_KEY]: status, [THEME_STORAGE_KEY]: theme });
  for (const keys of ["desertfox_saved_settings", [CONFIG_STATUS_STORAGE_KEY, "desertfox_marks"], null, undefined, {}, [5]]) {
    await assert.rejects(browser.storage.local.get(keys), /reads only/, JSON.stringify(keys));
  }
  snapshots.theme = { v: V, value: { dark: {} } };
  assert.deepEqual(plain(await browser.storage.local.get(THEME_STORAGE_KEY)), {}, "a theme that fails its check reads as absent");
});

test("a snapshot change reaches storage.onChanged, and a keymap change reaches the page as tree_updated", async () => {
  const { browser, snapshots, changed } = load({ config: snap({ settings: {} }) });
  const changes: unknown[] = [];
  const messages: unknown[] = [];
  browser.storage.onChanged.addListener((change, area) => void changes.push([change, area]));
  browser.runtime.onMessage.addListener(((message: unknown) => void messages.push(message)) as never);
  snapshots.config = snap({ settings: { a: 1 } });
  changed("config");
  changed("keymap");
  changed("which_key");
  assert.deepEqual(plain(changes), [[{ [CONFIG_STATUS_STORAGE_KEY]: { newValue: { settings: { a: 1 } } } }, "local"]]);
  assert.deepEqual(plain(messages), [{ type: "tree_updated" }]);
});

test("a push reaches the listeners, and the first that answers gives the answer text", async () => {
  const { browser, push } = load();
  const skipped = (() => undefined) as never;
  const answers = ((message: { type: string }) => (message.type === "get_selection" ? Promise.resolve("picked") : undefined)) as never;
  const responds = ((message: { type: string }, _sender: unknown, respond: (value: unknown) => void) => {
    if (message.type !== "ping") return undefined;
    respond(true);
    return true;
  }) as never;
  browser.runtime.onMessage.addListener(skipped);
  browser.runtime.onMessage.addListener(answers);
  browser.runtime.onMessage.addListener(responds);
  assert.deepEqual(JSON.parse(await push('{"type":"get_selection"}')), { value: "picked" });
  assert.deepEqual(JSON.parse(await push('{"type":"ping"}')), { value: true });
  assert.deepEqual(JSON.parse(await push('{"type":"frame_mode"}')), {});
  browser.runtime.onMessage.removeListener(answers);
  assert.deepEqual(JSON.parse(await push('{"type":"get_selection"}')), {});
  for (const junk of ["not json", "[]", '{"type":5}', "null"]) assert.ok((JSON.parse(await push(junk)) as { error?: string }).error, junk);
  assert.match((JSON.parse(await push(JSON.stringify({ type: "refusal", pad: "p".repeat(MAX_KIND_BYTES) }))) as { error: string }).error, /too large/);
  const thrower = ((message: { type: string }) => (message.type === "boom" ? Promise.reject(new Error("listener failed")) : undefined)) as never;
  browser.runtime.onMessage.addListener(thrower);
  assert.deepEqual(JSON.parse(await push('{"type":"boom"}')), { error: "listener failed" });
});

test("an answer too large to send back becomes an error", async () => {
  const { browser, push } = load();
  browser.runtime.onMessage.addListener((() => Promise.resolve("a".repeat(MAX_KIND_BYTES))) as never);
  assert.deepEqual(JSON.parse(await push('{"type":"get_selection"}')), { error: "the answer is too large" });
});

test("the runtime facts: id, extension URLs and frame 0", () => {
  const { browser } = load();
  assert.equal(browser.runtime.id, "desertfox@uhs-robert");
  assert.equal(browser.runtime.getURL("hints.js"), "moz-extension://abc/hints.js");
  assert.equal(browser.runtime.getURL("/commands.json"), "moz-extension://abc/commands.json");
  assert.equal(browser.runtime.getFrameId(), 0);
});

test("after the extension unloads the id is gone and every call, read and push is refused", async () => {
  const { browser, state, push, changed } = load({ config: snap({ settings: {} }) });
  const changes: unknown[] = [];
  browser.storage.onChanged.addListener((change) => void changes.push(change));
  state.alive = false;
  assert.equal(browser.runtime.id, undefined);
  await assert.rejects(browser.runtime.sendMessage({ type: "run", invocations: [], mode: "normal" }), /invalidated/);
  await assert.rejects(browser.runtime.sendMessage({ type: "read_keymap", join: true, url: "" }), /invalidated/);
  await assert.rejects(browser.storage.local.get(CONFIG_STATUS_STORAGE_KEY), /invalidated/);
  assert.match((JSON.parse(await push('{"type":"ping"}')) as { error: string }).error, /invalidated/);
  changed("config");
  assert.deepEqual(changes, []);
  assert.deepEqual(state.calls, []);
});

test("without a transport the shim defines nothing", () => {
  const context = vm.createContext({});
  vm.runInContext(bundle, context);
  assert.equal((context as { browser?: unknown }).browser, undefined);
});

test("a bundle load the module answers with anything but a RunResponse counts as failed", async () => {
  const { browser, state } = load();
  for (const answer of [undefined, null, "done", { ok: "yes" }, []]) {
    state.load_answer = answer;
    assert.deepEqual(plain(await browser.runtime.sendMessage({ type: "load_bundle", name: "hints" })), { ok: false, refusal: { id: "load_bundle", message: "the browser module did not load the bundle" } }, JSON.stringify(answer));
  }
  state.load_answer = { ok: false, refusal: { id: "x", message: "missing" } };
  assert.deepEqual(plain(await browser.runtime.sendMessage({ type: "load_bundle", name: "hints" })), { ok: false, refusal: { id: "x", message: "missing" } });
});
