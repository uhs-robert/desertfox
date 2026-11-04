import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { make_settings_handlers, plan_set, plan_unset } from "../../src/commands/settings.ts";
import type { SettingsDeps } from "../../src/commands/settings.ts";
import { empty_config } from "../../src/background/config_load.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import type { MergedConfig, SettingOverrides } from "../../src/shared/config.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { parse_command_line } from "../../src/shared/registry/command_line.ts";
import { registry } from "../../src/shared/registry/index.ts";

const config = (settings: MergedConfig["settings"] = {}): MergedConfig => ({ ...empty_config(), settings });

test("set name value stores the typed value and answers with a success toast", () => {
  const plan = plan_set("which_key_delay_ms 500", {}, config());
  assert.deepEqual(plan, { next: { which_key_delay_ms: 500 }, toast: { kind: "success", message: "which_key_delay_ms = 500" } });
});

test("name=value is the same as name value", () => {
  assert.deepEqual(plan_set("which_key_delay_ms=500", {}, config()).next, { which_key_delay_ms: 500 });
  assert.deepEqual(plan_set("which_key_delay_ms= 500", {}, config()).next, { which_key_delay_ms: 500 });
  assert.deepEqual(plan_set("new_tab_page=https://a.test/?q=1", {}, config()).next, { new_tab_page: "https://a.test/?q=1" });
});

test("a new set keeps the overrides already there", () => {
  assert.deepEqual(plan_set("hint_letters qwer", { which_key_delay_ms: 5 }, config()).next, { which_key_delay_ms: 5, hint_letters: "qwer" });
});

test("a name alone shows the value in force, without a change", () => {
  const plan = plan_set("which_key_delay_ms", {}, config({ which_key_delay_ms: 42 }));
  assert.deepEqual(plan, { toast: { kind: "info", message: "which_key_delay_ms = 42" } });
  assert.equal(plan_set("home_page", {}, config()).toast.message, "home_page is not set");
});

test("name! flips a boolean from its value, or from what an absent setting reads as", () => {
  assert.deepEqual(plan_set("completion_all_windows!", {}, config()).next, { completion_all_windows: true });
  assert.deepEqual(plan_set("newtab_date!", {}, config()).next, { newtab_date: false });
  assert.deepEqual(plan_set("newtab_date!", { newtab_date: false }, config({ newtab_date: false })).next, { newtab_date: true });
  assert.throws(() => plan_set("which_key_delay_ms!", {}, config()), /cannot flip/);
  assert.throws(() => plan_set("newtab_clock!", {}, config()), /cannot flip/);
});

test("a list takes one item per word", () => {
  assert.deepEqual(plan_set("ignore_sites a.com  b.com", {}, config()).next, { ignore_sites: ["a.com", "b.com"] });
});

test("a bad value, an unknown name and a group setting are refused", () => {
  assert.throws(() => plan_set("light_intensity 9", {}, config()), /light_intensity: expected a whole number from 1 to 5/);
  assert.throws(() => plan_set("nope 1", {}, config()), /Unknown setting "nope"/);
  assert.throws(() => plan_set("search_prefixes x", {}, config()), /settings.toml/);
  assert.throws(() => plan_set("container_prefixes", {}, config()), /settings.toml/);
  assert.throws(() => plan_set("", {}, config()), /Name a setting/);
});

test("default_engine or palette naming nothing is kept with a warning", () => {
  const engine = plan_set("default_engine nothing", {}, config());
  assert.equal(engine.toast.kind, "warning");
  assert.deepEqual(engine.next, { default_engine: "nothing" });
  assert.equal(plan_set("default_engine duck", {}, config()).toast.kind, "success");
  assert.equal(plan_set("palette nothing", {}, config()).toast.kind, "warning");
  assert.equal(plan_set("palette oasis_moonlight", {}, config()).toast.kind, "success");
});

test("unset removes one override, says so for a name that is not set, and does nothing bare", () => {
  assert.deepEqual(plan_unset("hint_letters", { hint_letters: "ab", newtab_date: false }), { next: { newtab_date: false }, toast: { kind: "success", message: "Unset hint_letters" } });
  assert.deepEqual(plan_unset("hint_letters", {}), { toast: { kind: "info", message: "hint_letters is not overridden" } });
  const bare = plan_unset("", { hint_letters: "ab" });
  assert.equal(bare.next, undefined);
  assert.match(bare.toast.message, /all/);
  assert.throws(() => plan_unset("nope", {}), /Unknown setting/);
  assert.throws(() => plan_unset("a b", {}), /one setting name/);
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
      const next = decide(state.overrides, config());
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
  await handlers.set(ctx, { setting: "hint_letters qwer" });
  await handlers.set(ctx, { setting: "hint_letters" });
  await handlers.unset(ctx, { setting: "" });
  await handlers.unset(ctx, { setting: "all" });
  assert.deepEqual(toasts, ['success hint_letters = "qwer"', 'info hint_letters = "asdfghjkl"', "info Name a setting to unset, or all", "success Cleared 1 override"]);
  assert.equal(state.publishes, 2);
  assert.deepEqual(state.overrides, {});
});

test("a refused value toasts nothing and changes nothing: the router shows the error", async () => {
  const { deps, toasts, state } = fake_deps();
  await assert.rejects(make_settings_handlers(deps).set(ctx, { setting: "light_intensity 9" }), /expected a whole number/);
  assert.deepEqual(toasts, []);
  assert.equal(state.publishes, 0);
});

test("the command line text reaches the command as one setting argument", () => {
  const parsed = parse_command_line(registry, "set ignore_sites a.com b.com");
  assert.ok(parsed.kind === "invocation");
  const checked = check_args(registry.get("settings.set")!, parsed.invocation.args);
  assert.ok(checked.ok);
  assert.equal(checked.args.setting, "ignore_sites a.com b.com");
  const bare = parse_command_line(registry, "unset");
  assert.ok(bare.kind === "invocation" && check_args(registry.get("settings.unset")!, bare.invocation.args).ok);
  const keyed = parse_command_line(registry, "set which_key_delay_ms=500");
  assert.ok(keyed.kind === "invocation");
  assert.equal(keyed.invocation.args?.setting, "which_key_delay_ms=500");
});
