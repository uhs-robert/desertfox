import assert from "node:assert/strict";
import { test } from "node:test";
import { bundles } from "../../src/content/bundles.ts";
import { content_handlers } from "../../src/content/handler_map.ts";
import { create_key_flow } from "../../src/content/key_flow.ts";
import { create_mode_state } from "../../src/content/mode_state.ts";
import { run_content_invocation, run_content_steps } from "../../src/content/run_content.ts";
import { create_matcher } from "../../src/shared/keys/index.ts";
import { COMPILED_KEYMAP_VERSION } from "../../src/shared/index.ts";
import type { BundleName, CompiledKeymap, LeafStep } from "../../src/shared/index.ts";
import "../../src/background/command_modules.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

// `bundles` is one host per frame, so these tests share it. It remembers a loaded bundle, so each test uses a bundle the ones before did not load.
function connect(asked: string[], shown: string[], on_idle_ = () => {}, load: () => Promise<boolean> = async () => true) {
  bundles.connect({
    request_bundle_: (name) => {
      asked.push(name);
      return load();
    },
    on_idle_,
    set_mode_: () => {},
    show_error_: (message) => shown.push(message),
    on_sink_missing_: () => {},
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

test("the refusal names the missing bundle in words a user reads", async () => {
  const shown: string[] = [];
  connect([], shown);
  assert.deepEqual(await run_content_invocation({ id: "cmdline.open", bundle: "cmdline" }, "ignore"), { ok: false, message: "needs the command line" });
  assert.deepEqual(await run_content_invocation({ id: "help.whichkey", bundle: "whichkey" }, "ignore"), { ok: false, message: "needs the which-key panel" });
  assert.deepEqual(shown, []);
});

test("an id with no handler and no bundle field is failed", async () => {
  assert.deepEqual(await run_content_invocation({ id: "hint.run" }, "ignore"), { ok: false, message: "hint.run cannot run in the page" });
});

test("every command with a bundle field names a real bundle, has no run, and has no entry in the handler map", () => {
  const lazy = registry.list().filter((command) => command.bundle !== undefined);
  assert.equal(lazy.length, 22);
  for (const command of lazy) {
    assert.equal(command.runs_in, "content", command.id);
    assert.equal(command.run, undefined, command.id);
    assert.equal(content_handlers[command.id], undefined, command.id);
  }
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
    which_key_delay_ms: 0,
    modes: { normal: { kind: "branch", children: { n: leaf("find.next", "caret"), x: leaf("t.plain") } } },
  };
  content_handlers["t.plain"] = { run: () => void events.push("plain x") };
  const flow = create_key_flow({
    get_mode: state.get_mode,
    take_pass_next_: state.take_pass_next_,
    in_editable_field_: () => false,
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

test("every content command without a bundle has a handler in the content script", () => {
  const missing = registry.list().filter((command) => command.runs_in === "content" && !command.bundle && !content_handlers[command.id]).map((command) => command.id);
  assert.deepEqual(missing, []);
});
