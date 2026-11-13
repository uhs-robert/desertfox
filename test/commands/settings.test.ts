import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { make_settings_handlers, plan_set, plan_toggle, plan_unset } from "../../src/commands/settings.ts";
import type { SettingsDeps } from "../../src/commands/settings.ts";
import { empty_config } from "../../src/background/config_load.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import { NO_EDITS } from "../../src/shared/config.ts";
import type { MergedConfig, SettingEdits, SettingOverrides } from "../../src/shared/config.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { parse_command_line } from "../../src/shared/registry/command_line.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

const config = (settings: MergedConfig["settings"] = {}): MergedConfig => ({ ...empty_config(), settings });
const saved = (layer: SettingOverrides): SettingEdits => ({ saved: layer, temp: {} });

test("set stores the typed value and answers with a success toast", () => {
  const plan = plan_set("which_key_delay_ms", "500", "saved", NO_EDITS, config());
  assert.deepEqual(plan, { next: saved({ which_key_delay_ms: 500 }), toast: { kind: "success", message: "which_key_delay_ms = 500" } });
});

test("a new set keeps the edits already there", () => {
  assert.deepEqual(plan_set("hint_letters", "qwer", "saved", saved({ which_key_delay_ms: 5 }), config()).next, saved({ which_key_delay_ms: 5, hint_letters: "qwer" }));
});

test("a name with no value shows the value in force, without a change", () => {
  const plan = plan_set("which_key_delay_ms", "", "saved", NO_EDITS, config({ which_key_delay_ms: 42 }));
  assert.deepEqual(plan, { toast: { kind: "info", message: "which_key_delay_ms = 42" } });
  assert.equal(plan_set("home_page", "", "saved", NO_EDITS, config()).toast.message, "home_page is not set");
});

test("toggle flips a boolean from its value, or from what an absent setting reads as", () => {
  assert.deepEqual(plan_toggle("completion_all_windows", "saved", NO_EDITS, config()).next, saved({ completion_all_windows: true }));
  assert.deepEqual(plan_toggle("newtab_date", "saved", NO_EDITS, config()).next, saved({ newtab_date: false }));
  assert.deepEqual(plan_toggle("newtab_date", "saved", saved({ newtab_date: false }), config({ newtab_date: false })).next, saved({ newtab_date: true }));
});

test("a list takes one item per word", () => {
  assert.deepEqual(plan_set("next_patterns", "a.com  b.com", "saved", NO_EDITS, config()).next, saved({ next_patterns: ["a.com", "b.com"] }));
});

test("[] sets an empty list, and no value still shows the list", () => {
  assert.deepEqual(plan_set("next_patterns", "[]", "saved", NO_EDITS, config({ next_patterns: ["a.com"] })).next, saved({ next_patterns: [] }));
  assert.deepEqual(plan_set("open_completion", "[]", "saved", NO_EDITS, config()).next, saved({ open_completion: [] }));
  assert.equal(plan_set("next_patterns", "", "saved", NO_EDITS, config({ next_patterns: ["a.com"] })).next, undefined);
});

test("default_engine or theme naming nothing is kept with a warning", () => {
  const engine = plan_set("default_engine", "nothing", "saved", NO_EDITS, config());
  assert.equal(engine.toast.kind, "warning");
  assert.deepEqual(engine.next, saved({ default_engine: "nothing" }));
  assert.equal(plan_set("default_engine", "duck", "saved", NO_EDITS, config()).toast.kind, "success");
  assert.equal(plan_set("theme", "nothing", "saved", NO_EDITS, config()).toast.kind, "warning");
  assert.equal(plan_set("theme", "oasis_moonlight", "saved", NO_EDITS, config()).toast.kind, "success");
  assert.equal(plan_set("theme", "desktop", "saved", NO_EDITS, config()).toast.kind, "success");
});

test("unset removes one edit and says so for a name that is not edited", () => {
  assert.deepEqual(plan_unset("hint_letters", false, saved({ hint_letters: "ab", newtab_date: false })), { next: saved({ newtab_date: false }), toast: { kind: "success", message: "Unset hint_letters" } });
  assert.deepEqual(plan_unset("hint_letters", false, NO_EDITS), { toast: { kind: "info", message: "hint_letters is not edited" } });
});

test("unset all clears every edit and counts them", () => {
  assert.deepEqual(plan_unset("all", false, saved({ hint_letters: "ab", newtab_date: false })), { next: saved({}), toast: { kind: "success", message: "Cleared 2 edits" } });
  assert.equal(plan_unset("all", false, saved({ hint_letters: "ab" })).toast.message, "Cleared 1 edit");
  assert.equal(plan_unset("all", false, NO_EDITS).next, undefined);
});

test("set --temp writes the temp layer, and a saved set drops the temp edit of that name", () => {
  const temp = plan_set("hint_letters", "qw", "temp", saved({ hint_letters: "ab" }), config());
  assert.deepEqual(temp.next, { saved: { hint_letters: "ab" }, temp: { hint_letters: "qw" } });
  assert.equal(temp.toast.message, 'hint_letters = "qw" until the browser restarts');
  const resaved = plan_set("hint_letters", "zx", "saved", { saved: {}, temp: { hint_letters: "qw", newtab_date: false } }, config());
  assert.deepEqual(resaved.next, { saved: { hint_letters: "zx" }, temp: { newtab_date: false } });
  assert.deepEqual(plan_toggle("newtab_date", "temp", NO_EDITS, config()).next, { saved: {}, temp: { newtab_date: false } });
});

test("unset drops both layers, and unset --temp drops only the temp edit", () => {
  const both: SettingEdits = { saved: { hint_letters: "ab", newtab_date: false }, temp: { hint_letters: "qw" } };
  assert.deepEqual(plan_unset("hint_letters", false, both).next, { saved: { newtab_date: false }, temp: {} });
  assert.deepEqual(plan_unset("hint_letters", true, both).next, { saved: both.saved, temp: {} });
  assert.deepEqual(plan_unset("newtab_date", true, both).toast, { kind: "info", message: "newtab_date has no temp edit" });
  assert.deepEqual(plan_unset("all", true, both), { next: { saved: both.saved, temp: {} }, toast: { kind: "success", message: "Cleared 1 edit" } });
  assert.deepEqual(plan_unset("all", false, both).toast.message, "Cleared 3 edits");
});

const ctx: CommandContext = { tab_id: 7, window_id: 1, frame_id: 0, mode: "normal" };

function fake_deps(initial: SettingEdits = NO_EDITS) {
  const toasts: string[] = [];
  const state = { edits: initial, publishes: 0 };
  const deps: SettingsDeps = {
    change_edits: async (decide) => {
      const next = decide(state.edits, config({ ...state.edits.saved, ...state.edits.temp }));
      if (next === undefined) return;
      state.edits = next;
      state.publishes++;
    },
    toast: async (_ctx, kind, message) => void toasts.push(`${kind} ${message}`),
  };
  return { deps, toasts, state };
}

test("the handler toasts after the change and publishes only on a change", async () => {
  const { deps, toasts, state } = fake_deps();
  const handlers = make_settings_handlers(deps);
  await handlers.set(ctx, { name: "hint_letters", value: "qwer" });
  await handlers.set(ctx, { name: "hint_letters", value: "" });
  await handlers.unset(ctx, { name: "newtab_date" });
  await handlers.unset(ctx, { name: "all" });
  assert.deepEqual(toasts, ['success hint_letters = "qwer"', 'info hint_letters = "qwer"', "info newtab_date is not edited", "success Cleared 1 edit"]);
  assert.equal(state.publishes, 2);
  assert.deepEqual(state.edits, NO_EDITS);
  await handlers.set(ctx, { name: "hint_letters", value: "qwer", temp: true });
  assert.deepEqual(state.edits, { saved: {}, temp: { hint_letters: "qwer" } });
});

function checked(text: string) {
  const parsed = parse_command_line(registry, text);
  assert.ok(parsed.kind === "invocation", text);
  return check_args(registry.get(parsed.invocation.id)!, parsed.invocation.args);
}

test("the command line fills the name, then the value, and the schema refuses what the old handler refused", () => {
  const set = checked("set next_patterns a.com b.com");
  assert.ok(set.ok);
  assert.deepEqual(set.args, { temp: false, name: "next_patterns", value: "a.com b.com" });
  assert.deepEqual(checked("set which_key_delay_ms").ok, true);
  assert.match(checked("set light_intensity 9").ok ? "" : (checked("set light_intensity 9") as { error: string }).error, /light_intensity: expected a whole number from 1 to 5/);
  for (const text of ["set nope 1", "set search_prefixes x", "set", "unset", "unset nope", "unset a b", "toggle which_key_delay_ms", "toggle"]) {
    assert.equal(checked(text).ok, false, text);
  }
  for (const text of ["unset all", "unset hint_letters", "toggle newtab_date", "set --temp hint_letters ab", "toggle -t newtab_date", "unset --temp all"]) assert.equal(checked(text).ok, true, text);
  const temp = checked("set -t hint_letters ab");
  assert.ok(temp.ok);
  assert.deepEqual(temp.args, { temp: true, name: "hint_letters", value: "ab" });
});
