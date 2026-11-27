import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { bundles } from "../../src/content/bundles.ts";
import { content_handlers } from "../../src/content/handler_map.ts";
import { create_key_flow } from "../../src/content/key_flow.ts";
import { create_mode_state } from "../../src/content/mode_state.ts";
import { run_content_invocation, run_content_steps } from "../../src/content/run_content.ts";
import { create_matcher } from "../../src/shared/keys/index.ts";
import { COMPILED_KEYMAP_VERSION } from "../../src/shared/index.ts";
import { is_bundle_name } from "../../src/shared/bundles.ts";
import type { BundleName, CompiledKeymap, LeafStep } from "../../src/shared/index.ts";
import "../../src/background/command_modules.ts";
import { shipped_sources } from "../support/metafile.ts";
import { make_tmp_dir } from "../support/tmp_dir.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

// `bundles` is one host per frame, so these tests share it. It remembers a loaded bundle, so each test uses a bundle the ones before did not load.
function connect(asked: string[], shown: string[], on_idle_ = () => {}, load: () => Promise<boolean> = async () => true) {
  bundles.connect({
    request_bundle_: (name) => {
      asked.push(name);
      return load();
    },
    on_idle_,
    hold_first_: () => {},
    set_mode_: () => {},
    show_error_: (message) => shown.push(message),
  });
}

test("a command with a bundle field loads its bundle and refuses with the reason while the bundle registers nothing", async () => {
  const shown: string[] = [];
  const asked: string[] = [];
  connect(asked, shown);
  const answer = run_content_invocation({ id: "hint.run", args: {}, bundle: "hints" }, "ignore");
  assert.equal(bundles.is_loading_(), true);
  assert.deepEqual(await answer, { ok: false, message: "needs hints" });
  assert.deepEqual(asked, ["hints"]);
  assert.deepEqual(shown, []);
  assert.equal(bundles.is_loading_(), false);
});

test("the refusal names the bundle that registered no handler", async () => {
  const shown: string[] = [];
  connect([], shown);
  assert.deepEqual(await run_content_invocation({ id: "cmdline.open", bundle: "cmdline" }, "ignore"), { ok: false, message: "needs cmdline" });
  assert.deepEqual(await run_content_invocation({ id: "help.whichkey", bundle: "whichkey" }, "ignore"), { ok: false, message: "needs whichkey" });
  assert.deepEqual(shown, []);
});

test("an id with no handler and no bundle field is failed", async () => {
  assert.deepEqual(await run_content_invocation({ id: "hint.run" }, "ignore"), { ok: false, message: "hint.run cannot run in the page" });
});

// The ids a bundle registers, read from the files its entry ships (a file the entry never imports does not count): a literal `register_handler_("id", ...)`, or a string constant of those files.
async function registered_ids(entry: string): Promise<Set<string>> {
  const files = await shipped_sources(entry);
  const text = files.map((file) => readFileSync(file, "utf8")).join("\n");
  const ids = new Set<string>();
  for (const [, id] of text.matchAll(/register_handler_\(\s*"([^"]+)"/g)) ids.add(id!);
  for (const [, name] of text.matchAll(/register_handler_\(\s*([A-Z_]+)\s*,/g)) {
    const defined = text.match(new RegExp(`const ${name} = "([^"]+)"`));
    assert.ok(defined, `${name} is not defined as a string constant in the bundle of ${entry}`);
    ids.add(defined[1]!);
  }
  return ids;
}

// These lazy commands register no handler by id. The command line sink (BUNDLE_FOR_MODE) takes their keys while the line is open.
const SINK_DRIVEN_IDS = new Set([
  "cmdline.next_completion",
  "cmdline.prev_completion",
  "cmdline.submit",
  "cmdline.history",
  "cmdline.clear",
  "cmdline.help",
  "list.act",
  "list.select",
]);

test("every command with a bundle field names a real bundle, has no run, and has no entry in the handler map", () => {
  const lazy = registry.list().filter((command) => command.bundle !== undefined);
  assert.ok(lazy.length > 0);
  for (const command of lazy) {
    assert.ok(is_bundle_name(command.bundle), command.id);
    assert.equal(command.runs_in, "content", command.id);
    assert.equal(command.run, undefined, command.id);
    assert.equal(content_handlers[command.id], undefined, command.id);
  }
});

const bundle_entry = (bundle: BundleName) => (bundle === "cmdline" ? "src/cmdline/host.ts" : `src/content/${bundle}/main.ts`);

test("a registration counts only in a file the bundle entry imports", async (t) => {
  const dir = make_tmp_dir("lazy_bundle_", t);
  writeFileSync(join(dir, "main.ts"), 'import "./imported.ts";\n');
  writeFileSync(join(dir, "imported.ts"), 'declare const host: { register_handler_: (id: string, run: () => void) => void };\nhost.register_handler_("seen.id", () => {});\n');
  writeFileSync(join(dir, "orphan.ts"), 'declare const host: { register_handler_: (id: string, run: () => void) => void };\nhost.register_handler_("orphan.id", () => {});\n');
  const ids = await registered_ids(join(dir, "main.ts"));
  assert.ok(ids.has("seen.id"));
  assert.ok(!ids.has("orphan.id"), "a file the entry never imports registered an id");
});

test("each lazy command is registered by its bundle, or is one of the sink-driven ids", async () => {
  const lazy = registry.list().filter((command) => command.bundle !== undefined);
  const ids_of = new Map<BundleName, Set<string>>();
  for (const command of lazy) {
    const bundle = command.bundle as BundleName;
    if (!ids_of.has(bundle)) ids_of.set(bundle, await registered_ids(bundle_entry(bundle)));
    const registered = ids_of.get(bundle)!.has(command.id);
    if (SINK_DRIVEN_IDS.has(command.id)) assert.equal(registered, false, `${command.id} registers a handler now: take it off SINK_DRIVEN_IDS`);
    else assert.ok(registered, `${command.id} names the ${bundle} bundle, which registers no handler for it`);
  }
  for (const id of SINK_DRIVEN_IDS) assert.ok(lazy.some((command) => command.id === id && command.bundle === "cmdline"), `${id} is not a cmdline lazy command: drop it from SINK_DRIVEN_IDS`);
});

test("the first key of a lazy command waits one bundle load, holds the keys typed meanwhile and replays them after the handler runs", async () => {
  const events: string[] = [];
  const asked: string[] = [];
  const shown: string[] = [];
  const state = create_mode_state();
  const step = (id: string, bundle?: BundleName): LeafStep => ({ invocation: { id }, runs_in: "content", count_rule: "ignore", ...(bundle && { bundle }) });
  const leaf = (id: string, bundle?: BundleName) => ({ kind: "leaf" as const, steps: [step(id, bundle)] });
  const keymap: CompiledKeymap = {
    format_version: COMPILED_KEYMAP_VERSION,
    mode_indicator: "always",
    which_key_delay_ms: 0, toast_ms: 3000, toast_error_ms: 6000,
    modes: { normal: { kind: "branch", children: { n: leaf("find.next", "caret"), x: leaf("t.plain") } } },
  };
  content_handlers["t.plain"] = { run: () => void events.push("plain x") };
  const flow = create_key_flow({
    get_mode_: state.get_mode_,
    take_pass_next_: state.take_pass_next_,
    in_editable_field_: () => false,
    user_input_seen_: () => false,
    blur_window_open_: () => false,
    escape_to_page_: () => false,
    is_loading_: bundles.is_loading_,
    loading_sink_bundles_: bundles.loading_sink_bundles_,
    sink_of_: bundles.sink_of_,
    on_prefix_: () => {},
    leave_insert_: () => state.escape(),
    run_leaf_: (matched) => void run_content_steps(matched.steps, undefined).then((outcome) => outcome.ok || shown.push(outcome.message)),
  });
  flow.set_matcher_(create_matcher(keymap));
  let finish_load: () => void = () => {};
  connect(asked, shown, flow.release, () => new Promise<boolean>((resolve) => (finish_load = () => resolve(true))));

  assert.equal(flow.handle_token_("n"), "cancel");
  assert.equal(flow.handle_token_("x"), "cancel");
  assert.equal(events.length, 0);
  assert.deepEqual(asked, ["caret"]);
  assert.equal(events.length, 0);
  bundles.api.register_handler_("find.next", () => void events.push("find.next"));
  finish_load();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(asked, ["caret"]);
  assert.deepEqual(events, ["find.next", "plain x"]);
  assert.deepEqual(shown, []);
  assert.equal(bundles.is_loading_(), false);
});

test("a bound chord typed during a bundle load waits and runs after it, and an unbound chord still goes to the browser", async () => {
  const events: string[] = [];
  const asked: string[] = [];
  const shown: string[] = [];
  const state = create_mode_state();
  const jump = { kind: "leaf" as const, steps: [{ invocation: { id: "page.jump", args: { direction: "older" }, bundle: "page" as const }, runs_in: "content" as const, count_rule: "ignore" as const, bundle: "page" as const }] };
  const keymap: CompiledKeymap = { format_version: COMPILED_KEYMAP_VERSION, mode_indicator: "always", which_key_delay_ms: 0, toast_ms: 3000, toast_error_ms: 6000, modes: { normal: { kind: "branch", children: { "<C-o>": jump } } } };
  const flow = create_key_flow({
    get_mode_: state.get_mode_,
    take_pass_next_: state.take_pass_next_,
    in_editable_field_: () => false,
    user_input_seen_: () => false,
    blur_window_open_: () => false,
    escape_to_page_: () => false,
    is_loading_: bundles.is_loading_,
    loading_sink_bundles_: bundles.loading_sink_bundles_,
    sink_of_: bundles.sink_of_,
    on_prefix_: () => {},
    leave_insert_: () => state.escape(),
    run_leaf_: (matched) => void run_content_steps(matched.steps, undefined).then((outcome) => outcome.ok || shown.push(outcome.message)),
  });
  flow.set_matcher_(create_matcher(keymap));
  let finish_load: () => void = () => {};
  connect(asked, shown, flow.release, () => new Promise<boolean>((resolve) => (finish_load = () => resolve(true))));

  // The first press runs and starts the load. An unbound chord goes on to the browser, a bound one waits.
  assert.equal(flow.handle_token_("<C-o>"), "cancel");
  assert.equal(flow.handle_token_("<C-q>"), "pass");
  assert.equal(flow.handle_token_("<C-o>"), "cancel");
  assert.equal(events.length, 0);
  bundles.api.register_handler_("page.jump", () => void events.push("page.jump"));
  finish_load();
  for (let tick = 0; tick < 5; tick++) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(asked, ["page"]);
  assert.deepEqual(events, ["page.jump", "page.jump"]);
  assert.deepEqual(shown, []);
});

test("every content command without a bundle has a handler in the content script", () => {
  const missing = registry.list().filter((command) => command.runs_in === "content" && !command.bundle && !content_handlers[command.id]).map((command) => command.id);
  assert.deepEqual(missing, []);
});
