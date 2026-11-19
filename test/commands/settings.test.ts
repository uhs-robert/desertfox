import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { make_settings_handlers, plan_set, plan_set_value, plan_toggle, plan_unset } from "../../src/commands/settings.ts";
import { FILE_WRITTEN_SETTINGS, is_consent_setting, SETTING_NAMES, SETTING_SPECS } from "../../src/shared/settings_schema.ts";
import type { SettingsDeps } from "../../src/commands/settings.ts";
import type { FileWriteOutcome } from "../../src/background/settings_file.ts";
import type { UnsetResult } from "../../src/background/startup.ts";
import { empty_config } from "../../src/background/config_load.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import { NO_EDITS } from "../../src/shared/config.ts";
import type { MergedConfig, SettingEdits, SettingOverrides } from "../../src/shared/config.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { parse_command_line } from "../../src/shared/registry/command_line.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

const config = (settings: MergedConfig["settings"] = {}): MergedConfig => ({ ...empty_config(), settings });
const saved = (layer: SettingOverrides): SettingEdits => ({ saved: layer, temp: {} });
const SETTABLE_NAMES = SETTING_NAMES.filter((name) => SETTING_SPECS[name].settable);

const temp = (layer: SettingOverrides): SettingEdits => ({ saved: {}, temp: layer });

test("set stores the typed value and answers with a success toast", () => {
  const plan = plan_set("which_key_delay_ms", "500", "temp", NO_EDITS, config());
  assert.deepEqual(plan, { next: temp({ which_key_delay_ms: 500 }), toast: { kind: "success", message: "which_key_delay_ms = 500 until the browser restarts" } });
});

test("a new set keeps the edits already there", () => {
  assert.deepEqual(plan_set("hint_letters", "qwer", "temp", temp({ which_key_delay_ms: 5 }), config()).next, temp({ which_key_delay_ms: 5, hint_letters: "qwer" }));
  assert.deepEqual(plan_set("bridge", "true", "saved", saved({ newtab_ip_info: true }), config()).next, saved({ newtab_ip_info: true, bridge: true }));
});

test("a name with no value shows the value in force, without a change", () => {
  const plan = plan_set("which_key_delay_ms", "", "saved", NO_EDITS, config({ which_key_delay_ms: 42 }));
  assert.deepEqual(plan, { toast: { kind: "info", message: "which_key_delay_ms = 42" } });
  assert.equal(plan_set("home_page", "", "saved", NO_EDITS, config()).toast.message, "home_page is not set");
});

test("the saved layer takes the consent settings and refuses every other setting", () => {
  assert.deepEqual(plan_toggle("host_auto_update", "saved", NO_EDITS, config()).next, saved({ host_auto_update: true }));
  for (const name of SETTABLE_NAMES.filter((name) => !is_consent_setting(name))) {
    assert.throws(() => plan_set_value(name, "x", "saved", NO_EDITS, config()), /is not kept in the browser/, name);
  }
  assert.throws(() => plan_toggle("newtab_date", "saved", NO_EDITS, config()), /newtab_date is not kept in the browser/);
});

test("toggle flips a boolean from its value, or from what an absent setting reads as", () => {
  assert.deepEqual(plan_toggle("completion_all_windows", "temp", NO_EDITS, config()).next, temp({ completion_all_windows: true }));
  assert.deepEqual(plan_toggle("newtab_date", "temp", NO_EDITS, config()).next, temp({ newtab_date: false }));
  assert.deepEqual(plan_toggle("newtab_date", "temp", temp({ newtab_date: false }), config({ newtab_date: false })).next, temp({ newtab_date: true }));
  assert.deepEqual(plan_toggle("bridge", "saved", saved({ bridge: true }), config({ bridge: true })).next, saved({ bridge: false }));
});

test("a list takes one item per word", () => {
  assert.deepEqual(plan_set("next_patterns", "a.com  b.com", "temp", NO_EDITS, config()).next, temp({ next_patterns: ["a.com", "b.com"] }));
});

test("[] sets an empty list, and no value still shows the list", () => {
  assert.deepEqual(plan_set("next_patterns", "[]", "temp", NO_EDITS, config({ next_patterns: ["a.com"] })).next, temp({ next_patterns: [] }));
  assert.deepEqual(plan_set("open_completion", "[]", "temp", NO_EDITS, config()).next, temp({ open_completion: [] }));
  assert.equal(plan_set("next_patterns", "", "temp", NO_EDITS, config({ next_patterns: ["a.com"] })).next, undefined);
});

test("default_engine or theme naming nothing is kept with a warning", () => {
  const engine = plan_set("default_engine", "nothing", "temp", NO_EDITS, config());
  assert.equal(engine.toast.kind, "warning");
  assert.deepEqual(engine.next, temp({ default_engine: "nothing" }));
  assert.equal(plan_set("default_engine", "duck", "temp", NO_EDITS, config()).toast.kind, "success");
  assert.equal(plan_set("theme", "nothing", "temp", NO_EDITS, config()).toast.kind, "warning");
  assert.equal(plan_set("theme", "oasis_moonlight", "temp", NO_EDITS, config()).toast.kind, "success");
  assert.equal(plan_set("theme", "desktop", "temp", NO_EDITS, config()).toast.kind, "success");
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
  const resaved = plan_set("bridge", "true", "saved", { saved: {}, temp: { bridge: false, newtab_date: false } }, config());
  assert.deepEqual(resaved.next, { saved: { bridge: true }, temp: { newtab_date: false } });
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

// `outcome` answers every settings.toml write. The writes are recorded, as the file is not modelled.
function fake_deps(initial: SettingEdits = NO_EDITS, outcome: FileWriteOutcome = { kind: "written" }, unset_result: UnsetResult = outcome) {
  const toasts: string[] = [];
  const file_writes: string[] = [];
  const state = { edits: initial, publishes: 0 };
  const deps: SettingsDeps = {
    change_edits: async (decide) => {
      const next = decide(state.edits, config({ ...state.edits.saved, ...state.edits.temp }));
      if (next === undefined) return;
      state.edits = next;
      state.publishes++;
    },
    toast: async (_ctx, kind, message) => void toasts.push(`${kind} ${message}`),
    set_in_file: async (name, value) => {
      file_writes.push(`set ${name} ${JSON.stringify(value)}`);
      return outcome;
    },
    toggle_in_file: async (name) => {
      file_writes.push(`toggle ${name}`);
      return { value: false, outcome };
    },
    unset_in_file: async (name) => {
      file_writes.push(`unset ${name}`);
      return unset_result;
    },
    get_config: async () => config(),
  };
  return { deps, toasts, state, file_writes };
}

test("without --temp a set, toggle and unset go to settings.toml, and the toast says where they went", async () => {
  const { deps, toasts, state, file_writes } = fake_deps();
  const handlers = make_settings_handlers(deps);
  await handlers.set(ctx, { name: "hint_letters", value: "qwer" });
  await handlers.set(ctx, { name: "next_patterns", value: "a b" });
  await handlers.toggle(ctx, { name: "newtab_date" });
  await handlers.unset(ctx, { name: "newtab_date" });
  assert.deepEqual(file_writes, ['set hint_letters "qwer"', 'set next_patterns ["a","b"]', "toggle newtab_date", "unset newtab_date"]);
  assert.deepEqual(toasts, ['success hint_letters = "qwer", saved to settings.toml', 'success next_patterns = ["a","b"], saved to settings.toml', "success newtab_date = false, saved to settings.toml", "success Unset newtab_date, saved to settings.toml"]);
  assert.equal(state.publishes, 0);
});

test("--temp, a consent setting and unset all never touch settings.toml", async () => {
  const { deps, toasts, state, file_writes } = fake_deps();
  const handlers = make_settings_handlers(deps);
  await handlers.set(ctx, { name: "hint_letters", value: "qwer", temp: true });
  await handlers.toggle(ctx, { name: "newtab_date", temp: true });
  await handlers.set(ctx, { name: "bridge", value: "true" });
  await handlers.toggle(ctx, { name: "host_auto_update" });
  assert.deepEqual(state.edits, { saved: { bridge: true, host_auto_update: true }, temp: { hint_letters: "qwer", newtab_date: false } });
  await handlers.unset(ctx, { name: "hint_letters", temp: true });
  await handlers.unset(ctx, { name: "all" });
  assert.deepEqual(state.edits, NO_EDITS);
  assert.deepEqual(file_writes, []);
  assert.equal(toasts.at(-1), "success Cleared 3 edits");
});

test("a :set or :toggle without --temp of a setting other than a consent one never reaches the saved layer", async () => {
  const { deps, state, file_writes } = fake_deps();
  const handlers = make_settings_handlers(deps);
  for (const name of SETTABLE_NAMES.filter((name) => !is_consent_setting(name))) {
    if (!FILE_WRITTEN_SETTINGS.has(name)) {
      // The site rules: no text :set parses passes their check, so the schema refuses the line before any handler runs.
      for (const value of ["x", "[]", '[{ site = "a.test" }]']) assert.equal(check_args(registry.get("settings.set")!, { name, value }).ok, false, `${name} ${value}`);
      continue;
    }
    await handlers.set(ctx, { name, value: "x" });
    if (SETTING_SPECS[name].is_toggle) await handlers.toggle(ctx, { name });
  }
  assert.deepEqual(state.edits, NO_EDITS);
  assert.equal(state.publishes, 0);
  assert.ok(file_writes.length >= FILE_WRITTEN_SETTINGS.size);
});

test("set with no value shows the value and writes nothing", async () => {
  const { deps, toasts, file_writes } = fake_deps(saved({ hint_letters: "qwer" }));
  await make_settings_handlers(deps).set(ctx, { name: "hint_letters", value: "" });
  assert.deepEqual(toasts, ['info hint_letters = "qwer"']);
  assert.deepEqual(file_writes, []);
});

test("a write that left settings.toml as it was warns, and a missing or old host says when the file follows", async () => {
  const toast_for = async (outcome: FileWriteOutcome) => {
    const { deps, toasts } = fake_deps(NO_EDITS, outcome);
    await make_settings_handlers(deps).set(ctx, { name: "hint_letters", value: "qwer" });
    return toasts[0];
  };
  assert.equal(await toast_for({ kind: "failed", reason: "disk full" }), 'warning hint_letters = "qwer". settings.toml was not written (disk full). It is tried again at the next start');
  assert.match((await toast_for({ kind: "conflict" }))!, /^warning .*changed on disk/);
  assert.match((await toast_for({ kind: "replaced", by: "import", written: false }))!, /^warning .*was not written/);
  assert.equal(await toast_for({ kind: "waiting" }), 'success hint_letters = "qwer". settings.toml updates when the native host connects');
  assert.equal(await toast_for({ kind: "waiting", host_outdated: true }), 'success hint_letters = "qwer". settings.toml updates once the native host is updated');
  assert.ok(!(await toast_for({ kind: "waiting" }))!.includes("saved to"));
});

test("an unset answers for a key it removed, for browser edits alone and for nothing to drop", async () => {
  const unset_toast_for = async (result: UnsetResult) => {
    const { deps, toasts } = fake_deps(NO_EDITS, { kind: "written" }, result);
    await make_settings_handlers(deps).unset(ctx, { name: "toast_ms" });
    return toasts[0];
  };
  assert.equal(await unset_toast_for({ kind: "edits_only" }), "success Unset toast_ms");
  assert.equal(await unset_toast_for({ kind: "not_set" }), "info toast_ms is not set");
  assert.equal(await unset_toast_for({ kind: "waiting" }), "success Unset toast_ms. settings.toml updates when the native host connects");
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
