import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { make_settings_handlers, plan_set, plan_toggle, plan_unset } from "../../src/commands/settings.ts";
import type { SettingsDeps } from "../../src/commands/settings.ts";
import { empty_config } from "../../src/background/config_load.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import type { MergedConfig, SettingOverrides } from "../../src/shared/config.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { parse_command_line } from "../../src/shared/registry/command_line.ts";
import { registry } from "../../src/shared/registry/index.ts";

const config = (settings: MergedConfig["settings"] = {}): MergedConfig => ({ ...empty_config(), settings });

test("set stores the typed value and answers with a success toast", () => {
  const plan = plan_set("which_key_delay_ms", "500", {}, config());
  assert.deepEqual(plan, { next: { which_key_delay_ms: 500 }, toast: { kind: "success", message: "which_key_delay_ms = 500" } });
});

test("a new set keeps the overrides already there", () => {
  assert.deepEqual(plan_set("hint_letters", "qwer", { which_key_delay_ms: 5 }, config()).next, { which_key_delay_ms: 5, hint_letters: "qwer" });
});

test("a name with no value shows the value in force, without a change", () => {
  const plan = plan_set("which_key_delay_ms", "", {}, config({ which_key_delay_ms: 42 }));
  assert.deepEqual(plan, { toast: { kind: "info", message: "which_key_delay_ms = 42" } });
  assert.equal(plan_set("home_page", "", {}, config()).toast.message, "home_page is not set");
});

test("toggle flips a boolean from its value, or from what an absent setting reads as", () => {
  assert.deepEqual(plan_toggle("completion_all_windows", {}, config()).next, { completion_all_windows: true });
  assert.deepEqual(plan_toggle("newtab_date", {}, config()).next, { newtab_date: false });
  assert.deepEqual(plan_toggle("newtab_date", { newtab_date: false }, config({ newtab_date: false })).next, { newtab_date: true });
});

test("a list takes one item per word", () => {
  assert.deepEqual(plan_set("ignore_sites", "a.com  b.com", {}, config()).next, { ignore_sites: ["a.com", "b.com"] });
});

test("[] sets an empty list, and no value still shows the list", () => {
  assert.deepEqual(plan_set("ignore_sites", "[]", {}, config({ ignore_sites: ["a.com"] })).next, { ignore_sites: [] });
  assert.deepEqual(plan_set("open_completion", "[]", {}, config()).next, { open_completion: [] });
  assert.equal(plan_set("ignore_sites", "", {}, config({ ignore_sites: ["a.com"] })).next, undefined);
});

test("default_engine or palette naming nothing is kept with a warning", () => {
  const engine = plan_set("default_engine", "nothing", {}, config());
  assert.equal(engine.toast.kind, "warning");
  assert.deepEqual(engine.next, { default_engine: "nothing" });
  assert.equal(plan_set("default_engine", "duck", {}, config()).toast.kind, "success");
  assert.equal(plan_set("palette", "nothing", {}, config()).toast.kind, "warning");
  assert.equal(plan_set("palette", "oasis_moonlight", {}, config()).toast.kind, "success");
});

test("unset removes one override and says so for a name that is not set", () => {
  assert.deepEqual(plan_unset("hint_letters", { hint_letters: "ab", newtab_date: false }), { next: { newtab_date: false }, toast: { kind: "success", message: "Unset hint_letters" } });
  assert.deepEqual(plan_unset("hint_letters", {}), { toast: { kind: "info", message: "hint_letters is not overridden" } });
});

test("unset all clears every override and counts them", () => {
  assert.deepEqual(plan_unset("all", { hint_letters: "ab", newtab_date: false }), { next: {}, toast: { kind: "success", message: "Cleared 2 overrides" } });
  assert.equal(plan_unset("all", { hint_letters: "ab" }).toast.message, "Cleared 1 override");
  assert.equal(plan_unset("all", {}).next, undefined);
});

const ctx: CommandContext = { tab_id: 7, window_id: 1, frame_id: 0, mode: "normal" };

function fake_deps(initial: SettingOverrides = {}) {
  const toasts: string[] = [];
  const state = { overrides: initial, publishes: 0 };
  const deps: SettingsDeps = {
    change_overrides: async (decide) => {
      const next = decide(state.overrides, config(state.overrides));
      if (next === undefined) return;
      state.overrides = next;
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
  assert.deepEqual(toasts, ['success hint_letters = "qwer"', 'info hint_letters = "qwer"', "info newtab_date is not overridden", "success Cleared 1 override"]);
  assert.equal(state.publishes, 2);
  assert.deepEqual(state.overrides, {});
});

function checked(text: string) {
  const parsed = parse_command_line(registry, text);
  assert.ok(parsed.kind === "invocation", text);
  return check_args(registry.get(parsed.invocation.id)!, parsed.invocation.args);
}

test("the command line fills the name, then the value, and the schema refuses what the old handler refused", () => {
  const set = checked("set ignore_sites a.com b.com");
  assert.ok(set.ok);
  assert.deepEqual(set.args, { name: "ignore_sites", value: "a.com b.com" });
  assert.deepEqual(checked("set which_key_delay_ms").ok, true);
  assert.match(checked("set light_intensity 9").ok ? "" : (checked("set light_intensity 9") as { error: string }).error, /light_intensity: expected a whole number from 1 to 5/);
  for (const text of ["set nope 1", "set search_prefixes x", "set", "unset", "unset nope", "unset a b", "toggle which_key_delay_ms", "toggle"]) {
    assert.equal(checked(text).ok, false, text);
  }
  for (const text of ["unset all", "unset hint_letters", "toggle newtab_date"]) assert.equal(checked(text).ok, true, text);
});
