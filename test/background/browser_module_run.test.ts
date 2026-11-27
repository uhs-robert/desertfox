import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { create_browser_module } from "../../src/background/browser_module.ts";
import { create_module_run, with_address_bar } from "../../src/background/browser_module_run.ts";
import { create_router } from "../../src/background/router.ts";
import { compile_config } from "../../src/background/compile.ts";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";
import type { RouteRequest } from "../../src/background/router.ts";
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, BROWSER_MODULE_FROM_MODULE_STORAGE_KEY, BROWSER_MODULE_STATE_STORAGE_KEY, EXTENSION_TO_MODULE_KINDS, MAX_KEY_ROWS, validate_message } from "../../src/shared/browser_module_protocol.ts";
import type { ModuleState } from "../../src/shared/browser_module_protocol.ts";
import { locked_page_command_ids } from "../../src/shared/browser_module_scope.ts";
import { empty_config } from "../../src/shared/config/config_load.ts";
import type { KeymapConfig } from "../../src/shared/keymap.ts";
import { DEFAULT_KEYMAP } from "../../src/shared/keys/default_keymap.ts";
import type { Refusal, RunResponse } from "../../src/shared/messages/index.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../../src/shared/prefix_tree.ts";
import type { CompiledKeymap } from "../../src/shared/prefix_tree.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";

const locked_commands = locked_page_command_ids(registry.list());
const real_check = (id: string, args: Record<string, unknown> | undefined) => {
  const command = registry.get(id);
  const checked = command && check_args(command, args);
  return checked?.ok ? checked.args : undefined;
};
const compiled = (keymap: KeymapConfig = {}): CompiledKeymap => compile_config({ config: { ...empty_config(), keymap }, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} }).compiled;
const DEFAULT = compiled();

function run_setup(answer: RunResponse = { ok: true }) {
  const runs: RouteRequest[] = [];
  const shown: Refusal[] = [];
  const state = { keymap: DEFAULT as CompiledKeymap | undefined };
  const lines: number[] = [];
  const run = create_module_run({
    read_keymap: async () => state.keymap,
    locked_commands,
    run: async (request) => (runs.push(request), answer),
    show_refusal: async (_tab, refusal) => void shown.push(refusal),
    open_line: async () => void lines.push(1),
  });
  return { run, runs, shown, state, lines };
}

test("a run request runs its binding in the active tab, in normal mode, with the count", async () => {
  const { run, runs, shown } = run_setup();
  await run({ keys: "x x", count: 3 });
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0], { invocations: [{ id: "tab.close", args: { side: "none" }, count: 3 }], mode: "normal", may_prompt: true });
  // No sender tab: chrome names none, so the router takes the active tab.
  assert.equal("sender_tab_id" in runs[0]!, false);
  await run({ keys: "H", count: 0 });
  assert.deepEqual(runs[1]!.invocations, [{ id: "page.back", args: {} }]);
  assert.deepEqual(shown, []);
});

test("a prompt key reaches the router with its prompt, and the router opens the address bar", async () => {
  const { run, runs } = run_setup();
  await run({ keys: "o", count: 0 });
  assert.equal(runs[0]!.invocations[0]!.id, "open.url");
  assert.ok(runs[0]!.invocations[0]!.prompt);
});

test("a forged key and a page key never reach the router, and the user sees why", async () => {
  const { run, runs, shown } = run_setup();
  await assert.rejects(run({ keys: "Q Q Q", count: 0 }), /not a key/);
  await assert.rejects(run({ keys: "f", count: 0 }), /needs a page/);
  assert.equal(runs.length, 0);
  assert.equal(shown.length, 2);
  assert.ok(shown.every((refusal) => refusal.id === "browser_module.run"));
});

test("a count over the limit reaches the router, which refuses it before the command runs and tells the user", async () => {
  const shown: { tab_id: number | undefined; refusal: Refusal }[] = [];
  const ran: string[] = [];
  const get_command = (id: string) => {
    const command = registry.get(id);
    return command && { ...command, run: () => void ran.push(id) };
  };
  // A locked tab: no content script, so the refusal becomes a notification in `show_refusal`.
  const router = create_router({
    get_command,
    is_disabled: async () => false,
    active_tab: async () => ({ tab_id: 9, window_id: 1, url: "about:preferences" }),
    get_tab: async () => undefined,
    show_refusal: async (tab_id: number | undefined, refusal: Refusal) => void shown.push({ tab_id, refusal }),
    repeat_memory: { save: async () => undefined },
  } as never);
  const run = create_module_run({ read_keymap: async () => DEFAULT, locked_commands, run: router.run, show_refusal: async () => assert.fail("the handler showed its own refusal"), open_line: async () => assert.fail("no line opens") });
  await assert.rejects(run({ keys: "x x", count: 21 }), /over the limit of 20/);
  assert.deepEqual(ran, []);
  assert.equal(shown.length, 1);
  assert.equal(shown[0]!.tab_id, 9);
  assert.match(shown[0]!.refusal.message, /A count of 21 is over the limit of 20 for tab.close/);
});

test("junk keys and a bad count are refused without a notification", async () => {
  const { run, runs, shown } = run_setup();
  for (const args of [{ keys: "", count: 0 }, { keys: "x\u0007x", count: 0 }, { keys: "x x", count: -2 }, { keys: "x x", count: 10_000_000 }]) await assert.rejects(run(args), JSON.stringify(args));
  assert.equal(runs.length, 0);
  assert.deepEqual(shown, []);
});

test("a stale tree: keys the module still holds after a remap are matched against the new keymap", async () => {
  const { run, runs, state } = run_setup();
  state.keymap = compiled({ normal: { xx: null, J: { id: "tab.close" } } });
  await assert.rejects(run({ keys: "x x", count: 0 }), /not a key/);
  // J was the module's native tab.next. Now it closes the tab, and the background runs that.
  await run({ keys: "J", count: 0 });
  assert.deepEqual(runs.map((request) => request.invocations[0]!.id), ["tab.close"]);
  state.keymap = undefined;
  await assert.rejects(run({ keys: "J", count: 0 }), /no keymap/);
});

test("the router's refusal fails the request, so the module's reply says the keys did not run", async () => {
  const { run } = run_setup({ ok: false, refusal: { id: "tab.close", message: "no tab" } });
  await assert.rejects(run({ keys: "x x", count: 0 }), /no tab/);
});

function channel_setup(options: { keymap?: CompiledKeymap; disabled?: boolean; with_scope?: boolean } = {}) {
  const data = new Map<string, unknown>();
  const config = { on: true, disabled: options.disabled ?? false, keymap: options.keymap ?? DEFAULT, now: 50_000 };
  const timers: (() => void)[] = [];
  const handled: unknown[] = [];
  const session = {
    get: async (key: string | string[]) => Object.fromEntries([key].flat().filter((name) => data.has(name)).map((name) => [name, data.get(name)])),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => data.set(key, structuredClone(value))),
    remove: async (keys: string | string[]) => void [keys].flat().forEach((key) => data.delete(key)),
  };
  const module = create_browser_module({
    session: session as never,
    is_on: async () => config.on,
    read_disabled: async () => config.disabled,
    read_keymap: async () => config.keymap,
    read_tab_records: async () => ({}),
    check_args: real_check,
    ...(options.with_scope === false ? {} : { locked_commands }),
    handlers: { run: async (args) => void handled.push(args) },
    now: () => config.now,
    later: (run) => void timers.push(run),
  });
  const state = () => data.get(BROWSER_MODULE_STATE_STORAGE_KEY) as ModuleState | undefined;
  const flush = async () => {
    for (let turn = 0; turn < 3; turn++) await module.tab_changed("0", undefined);
  };
  return { data, config, module, state, flush, handled };
}

test("the state carries the tree beside the single keys, and an older writer's state has none", async () => {
  const { module, state } = channel_setup();
  await module.sync();
  assert.ok(state()!.tree, "the tree is written");
  assert.equal(state()!.tree!.children["J"] !== undefined, true);
  assert.ok(state()!.keys.some((row) => row.key === "J"), "the single keys stay for an older module");
  const without = channel_setup({ with_scope: false });
  await without.module.sync();
  assert.equal(without.state()!.tree, undefined);
});

test("the tree is rewritten on a keymap change and gone with the switch or the setting off", async () => {
  const { config, module, state, flush, data } = channel_setup();
  await module.sync();
  assert.equal(state()!.tree!.children["u"], "forward");
  config.keymap = compiled({ normal: { u: null } });
  module.storage_changed({ [COMPILED_KEYMAP_STORAGE_KEY]: {} }, "local");
  await flush();
  assert.equal(state()!.tree!.children["u"], undefined, "an unbound key leaves the module's tree");
  // A tab change rewrites the state and keeps the tree.
  await module.tab_changed("7", { top_mode: "normal" });
  assert.ok(state()!.tree);
  config.disabled = true;
  await module.sync();
  assert.equal(state()!.tree, undefined);
  assert.deepEqual(state()!.keys, []);
  config.on = false;
  await module.sync();
  assert.equal(data.has(BROWSER_MODULE_STATE_STORAGE_KEY), false);
});

test("a tree over its cap is left out and the single keys stay", async () => {
  const many: KeymapConfig["normal"] = {};
  for (let index = 0; index < 3000; index++) many[`<A-${String.fromCodePoint(0x4e00 + index)}>x`] = { id: "tab.close" };
  const { module, state } = channel_setup({ keymap: compiled({ normal: many }) });
  await module.sync();
  assert.equal(state()!.tree, undefined);
  assert.ok(state()!.keys.length > 0 && state()!.keys.length <= MAX_KEY_ROWS);
});

test("the channel takes a run request of the real kinds and drops junk, oversize and another version", async () => {
  const { data, config, module, flush, handled } = channel_setup();
  await module.sync();
  const request = (id: string, args: unknown, more: Record<string, unknown> = {}) => ({ v: 1, id, kind: "run", args, sent_at: config.now, ...more });
  data.set(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY, [
    request("good", { keys: "x x", count: 2 }),
    request("old", { keys: "x x", count: 0 }, { v: 2 }),
    request("big", { keys: "x ".repeat(400), count: 0 }),
    request("bad", { keys: ["x", "x"], count: 0 }),
    request("nocount", { keys: "x x" }),
    request("late", { keys: "x x", count: 0 }, { sent_at: config.now - 60_000 }),
  ]);
  module.storage_changed({ [BROWSER_MODULE_FROM_MODULE_STORAGE_KEY]: {} }, "session");
  await flush();
  assert.deepEqual(handled, [{ keys: "x x", count: 2 }]);
  const replies = data.get(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY) as { reply_to: string; ok: boolean }[];
  assert.deepEqual(replies.map((reply) => [reply.reply_to, reply.ok]).sort(), [["bad", false], ["big", false], ["good", true], ["late", false], ["nocount", false]]);
});

test("the panel, then the address bar, stand in for the command line only on a tab with no content script", async () => {
  const calls: unknown[] = [];
  const fails = async () => {
    throw new Error("no receiver");
  };
  const call = async (kind: string, args: Record<string, unknown>) => (calls.push([kind, args]), { ok: true as const });
  const panels: unknown[] = [];
  const panel = (opens: boolean) => async (tab_id: number, text: string) => (panels.push([tab_id, text]), opens);
  assert.deepEqual(await with_address_bar(fails, async () => false, panel(true), call)(4, 0, "open "), { ok: true, cancelled: true });
  assert.deepEqual(panels, [[4, "open "]]);
  assert.deepEqual(calls, [], "the address bar opened beside the panel");
  // The module refused the panel or has no handler for it.
  await with_address_bar(fails, async () => false, panel(false), call)(4, 0, "open ");
  assert.deepEqual(calls, [["address_bar.open", { text: "open ", tab_id: 4 }]]);
  await assert.rejects(with_address_bar(fails, async () => true, panel(true), call)(4, 0, "open "), /no receiver/);
  await assert.rejects(with_address_bar(fails, async () => false, panel(false), async () => ({ ok: false as const, error: "Needs the browser module" }))(4, 0, "open "), /no receiver/);
  assert.equal(await with_address_bar(async () => "opened", async () => false, panel(true), call)(4, 0, "open "), "opened");
  assert.equal(calls.length, 1);
  assert.equal(panels.length, 3);
  // The kind takes text, within its cap.
  assert.ok(validate_message({ v: 1, id: "a", kind: "address_bar.open", args: { text: "open " } }, EXTENSION_TO_MODULE_KINDS).ok);
  assert.deepEqual(validate_message({ v: 1, id: "a", kind: "address_bar.open", args: { text: "open ", tab_id: 4 } }, EXTENSION_TO_MODULE_KINDS), { ok: true, value: { v: 1, id: "a", kind: "address_bar.open", args: { text: "open ", tab_id: 4 } } });
  assert.equal(validate_message({ v: 1, id: "a", kind: "address_bar.open", args: { text: "open ", tab_id: 1.5 } }, EXTENSION_TO_MODULE_KINDS).ok, false);
  assert.equal(validate_message({ v: 1, id: "a", kind: "address_bar.open", args: { text: "x".repeat(5000) } }, EXTENSION_TO_MODULE_KINDS).ok, false);
});

test("the panel kind takes a whole tab id and nothing else", () => {
  assert.deepEqual(EXTENSION_TO_MODULE_KINDS["cmdline_panel.open"], { args: { tab_id: "int" }, reply: true, max_bytes: 256 });
  assert.ok(validate_message({ v: 1, id: "a", kind: "cmdline_panel.open", args: { tab_id: 7 } }, EXTENSION_TO_MODULE_KINDS).ok);
  for (const tab_id of [1.5, "7", undefined, null]) assert.equal(validate_message({ v: 1, id: "a", kind: "cmdline_panel.open", args: { tab_id } }, EXTENSION_TO_MODULE_KINDS).ok, false, String(tab_id));
  // An extra field such as an address is dropped, never passed on.
  const checked = validate_message({ v: 1, id: "a", kind: "cmdline_panel.open", args: { tab_id: 7, url: "https://example.com" } }, EXTENSION_TO_MODULE_KINDS);
  assert.ok(checked.ok && "kind" in checked.value && JSON.stringify(checked.value.args) === '{"tab_id":7}');
});

test("the bare command line key opens the line over the active tab and runs nothing through the router", async () => {
  const { run, runs, shown, lines } = run_setup();
  await run({ keys: ":", count: 0 });
  assert.deepEqual(lines, [1]);
  assert.deepEqual(runs, []);
  assert.deepEqual(shown, []);
});

test("a prompt step handed to the address bar ends the binding, so its later steps do not run", async () => {
  const ran: string[] = [];
  const bar_texts: unknown[] = [];
  const get_command = (id: string) => {
    const command = registry.get(id);
    return command && { ...command, run: () => void ran.push(id) };
  };
  const router = create_router({
    get_command,
    get_enum_sources: async () => ({ search_engines: [] }),
    is_disabled: async () => false,
    active_tab: async () => ({ tab_id: 9, window_id: 1, url: "about:preferences" }),
    get_tab: async () => undefined,
    has_content_script: async () => false,
    has_permission: async () => true,
    open_cmdline: with_address_bar(async () => Promise.reject(new Error("no receiver")), async () => false, async () => false, async (_kind, args) => (bar_texts.push(args["text"]), { ok: true as const })),
    show_refusal: async () => assert.fail("nothing is refused"),
    repeat_memory: { save: async () => undefined },
  } as never);
  const answer = await router.run({ invocations: [{ id: "open.url", prompt: { param: "url" } }, { id: "tab.close" }], mode: "normal", may_prompt: true });
  assert.deepEqual(answer, { ok: true, cancelled: true });
  assert.equal(bar_texts.length, 1);
  assert.deepEqual(ran, [], "tab.close ran while the bar was still open");
});
