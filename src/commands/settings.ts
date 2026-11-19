import { show_toast_on_tab } from "../background/browser_deps.ts";
import { change_edits, get_config, set_in_settings_file, toggle_in_settings_file, unset_in_settings_file } from "../background/startup.ts";
import type { UnsetResult } from "../background/startup.ts";
import { outcome_note } from "../background/settings_file.ts";
import type { FileWriteOutcome } from "../background/settings_file.ts";
import type { CommandContext } from "../shared/command.ts";
import { effective_settings } from "../shared/config.ts";
import type { MergedConfig, SettingEdits, SettingOverrides, Settings } from "../shared/config.ts";
import { built_in_theme_names } from "../shared/theme/load.ts";
import { DESKTOP_THEME } from "../shared/theme/roles.ts";
import { define } from "../shared/registry/builtin.ts";
import { FILE_WRITTEN_SETTINGS, is_consent_setting, parse_setting_text, SETTING_NAMES, SETTING_SPECS } from "../shared/settings_schema.ts";
import type { ToastKind } from "../shared/messages.ts";
import type { TomlValue } from "../background/toml_key_edit.ts";

type Toast = { kind: ToastKind; message: string };

// What a `:set`, `:toggle` or `:unset` comes to: the edits to keep (absent for no change) and the toast that answers it.
export type SettingsPlan = { next?: SettingEdits; toast: Toast };

// `saved` lasts and takes only the consent settings. `temp` ends when the browser restarts.
export type EditLayer = "saved" | "temp";

const show = (name: string, value: unknown): string => (value === undefined ? `${name} is not set` : `${name} = ${JSON.stringify(value)}`);

const UNTIL_RESTART = " until the browser restarts";

function without(layer: SettingOverrides, name: keyof Settings): SettingOverrides {
  const { [name]: _removed, ...rest } = layer;
  return rest;
}

// A saved edit drops the temp edit of the same name. Otherwise the temp edit keeps winning and the save shows no effect.
// Every other setting lasts in settings.toml, so the saved layer refuses it. A value an older version saved there stays until an unset or the start fold takes it out.
function edit_with(current: SettingEdits, layer: EditLayer, name: keyof Settings, value: unknown): SettingEdits {
  if (layer === "temp") return { saved: current.saved, temp: { ...current.temp, [name]: value } };
  if (!is_consent_setting(name)) throw new Error(`${name} is not kept in the browser. Only the consent settings are.`);
  return { saved: { ...current.saved, [name]: value }, temp: without(current.temp, name) };
}

// The build tool only warns about these two, so a live change does the same.
function naming_nothing(name: keyof Settings, value: unknown, config: MergedConfig): string | undefined {
  if (name === "default_engine" && typeof value === "string" && !Object.hasOwn(config.search_engines, value)) return `no search engine is named "${value}"`;
  if (name === "theme" && typeof value === "string" && value !== DESKTOP_THEME && !built_in_theme_names().includes(value) && !Object.hasOwn(config.local_themes ?? {}, value)) return `no theme is named "${value}"`;
  return undefined;
}

// The params already hold valid text: `name` is a known setting that `set` takes, and `value` passed that setting's check.
// `config` is the config under the edits now in force.
export function plan_set(name: keyof Settings, value_text: string, layer: EditLayer, current: SettingEdits, config: MergedConfig): SettingsPlan {
  if (value_text.trim() === "") return { toast: { kind: "info", message: show(name, effective_settings(config.settings)[name]) } };
  const { value } = parse_setting_text(name, value_text) as { value: unknown };
  return plan_set_value(name, value, layer, current, config);
}

// The settings page sends a typed value, so it skips the text guess of `plan_set`. The caller has run `SETTING_SPECS[name].check` on it.
export function plan_set_value(name: keyof Settings, value: unknown, layer: EditLayer, current: SettingEdits, config: MergedConfig): SettingsPlan {
  return { next: edit_with(current, layer, name, value), toast: set_toast(name, value, layer === "temp" ? UNTIL_RESTART : "", config) };
}

// `name = value`, then `note` (how long it lasts or where it went), then a warning when the value names nothing.
export function set_toast(name: keyof Settings, value: unknown, note: string, config: MergedConfig): Toast {
  const unmatched = naming_nothing(name, value, config);
  const message = unmatched === undefined ? `${show(name, value)}${note}` : `${show(name, value)}${note}, but ${unmatched}`;
  return { kind: unmatched === undefined ? "success" : "warning", message };
}

export function plan_toggle(name: keyof Settings, layer: EditLayer, current: SettingEdits, config: MergedConfig): SettingsPlan {
  const flipped = !effective_settings(config.settings)[name];
  const until = layer === "temp" ? UNTIL_RESTART : "";
  return { next: edit_with(current, layer, name, flipped), toast: { kind: "success", message: `${show(name, flipped)}${until}` } };
}

const count_words = (count: number): string => `${count} ${count === 1 ? "edit" : "edits"}`;

// Without `--temp`, unset drops the saved and the temp edit, so the config file value applies. With it, only the temp edit goes.
export function plan_unset(name: keyof Settings | "all", only_temp: boolean, current: SettingEdits): SettingsPlan {
  const kept_saved = (saved: SettingOverrides) => (only_temp ? current.saved : saved);
  if (name === "all") {
    const count = Object.keys(current.temp).length + (only_temp ? 0 : Object.keys(current.saved).length);
    if (count === 0) return { toast: { kind: "info", message: only_temp ? "No settings have a temp edit" : "No settings are edited" } };
    return { next: { saved: kept_saved({}), temp: {} }, toast: { kind: "success", message: `Cleared ${count_words(count)}` } };
  }
  const edited = Object.hasOwn(current.temp, name) || (!only_temp && Object.hasOwn(current.saved, name));
  if (!edited) return { toast: { kind: "info", message: only_temp ? `${name} has no temp edit` : `${name} is not edited` } };
  return { next: { saved: kept_saved(without(current.saved, name)), temp: without(current.temp, name) }, toast: { kind: "success", message: `Unset ${name}` } };
}

// A change that left settings.toml as it was, though the setting applies, warns: the file and the browser now differ.
const outcome_kind = (outcome: FileWriteOutcome): ToastKind =>
  outcome.kind === "failed" || outcome.kind === "held" || outcome.kind === "conflict" || outcome.kind === "conflict_kept" || (outcome.kind === "replaced" && !outcome.written) ? "warning" : "success";

export function unset_toast(name: keyof Settings, result: UnsetResult): Toast {
  if (result.kind === "not_set") return { kind: "info", message: `${name} is not set` };
  if (result.kind === "edits_only") return { kind: "success", message: `Unset ${name}` };
  return { kind: outcome_kind(result), message: `Unset ${name}${outcome_note(result)}` };
}

export type SettingsDeps = {
  change_edits: (decide: (current: SettingEdits, config: MergedConfig) => SettingEdits | undefined) => Promise<void>;
  toast: (ctx: CommandContext, kind: ToastKind, message: string) => Promise<void>;
  // The settings.toml writes of `startup.ts`, for the names in `FILE_WRITTEN_SETTINGS` without `--temp`.
  set_in_file: (name: keyof Settings, value: TomlValue) => Promise<FileWriteOutcome>;
  toggle_in_file: (name: keyof Settings) => Promise<{ value: boolean; outcome: FileWriteOutcome }>;
  unset_in_file: (name: keyof Settings) => Promise<UnsetResult>;
  get_config: () => Promise<MergedConfig>;
};

const layer_of = (temp: boolean | undefined): EditLayer => (temp ? "temp" : "saved");
const writes_file = (name: keyof Settings | "all", temp: boolean | undefined): name is keyof Settings => !temp && FILE_WRITTEN_SETTINGS.has(name);

export function make_settings_handlers(deps: SettingsDeps) {
  // The toast waits for the publish, so a success means the change is in force.
  async function apply(ctx: CommandContext, plan_for: (current: SettingEdits, config: MergedConfig) => SettingsPlan): Promise<void> {
    const plans: SettingsPlan[] = [];
    await deps.change_edits((current, config) => {
      const planned = plan_for(current, config);
      plans.push(planned);
      return planned.next;
    });
    const plan = plans.at(-1);
    if (plan) await deps.toast(ctx, plan.toast.kind, plan.toast.message);
  }
  // The toast waits for the host write too, so it says truly where the change went.
  async function set_in_file(ctx: CommandContext, name: keyof Settings, value_text: string): Promise<void> {
    const { value } = parse_setting_text(name, value_text) as { value: TomlValue };
    const outcome = await deps.set_in_file(name, value);
    const toast = set_toast(name, value, outcome_note(outcome), await deps.get_config());
    await deps.toast(ctx, toast.kind === "success" ? outcome_kind(outcome) : toast.kind, toast.message);
  }
  return {
    set: (ctx: CommandContext, args: { name: keyof Settings; value: string; temp?: boolean }) =>
      writes_file(args.name, args.temp) && args.value.trim() !== "" ? set_in_file(ctx, args.name, args.value) : apply(ctx, (current, config) => plan_set(args.name, args.value, layer_of(args.temp), current, config)),
    toggle: async (ctx: CommandContext, args: { name: keyof Settings; temp?: boolean }) => {
      if (!writes_file(args.name, args.temp)) return apply(ctx, (current, config) => plan_toggle(args.name, layer_of(args.temp), current, config));
      const { value, outcome } = await deps.toggle_in_file(args.name);
      await deps.toast(ctx, outcome_kind(outcome), `${show(args.name, value)}${outcome_note(outcome)}`);
    },
    unset: async (ctx: CommandContext, args: { name: keyof Settings | "all"; temp?: boolean }) => {
      if (!writes_file(args.name, args.temp)) return apply(ctx, (current) => plan_unset(args.name, args.temp === true, current));
      const toast = unset_toast(args.name, await deps.unset_in_file(args.name));
      await deps.toast(ctx, toast.kind, toast.message);
    },
  };
}

const handlers = make_settings_handlers({
  change_edits,
  toast: (ctx, kind, message) => show_toast_on_tab(ctx, "settings", message, kind),
  set_in_file: set_in_settings_file,
  toggle_in_file: toggle_in_settings_file,
  unset_in_file: unset_in_settings_file,
  get_config,
});

const SETTABLE = SETTING_NAMES.filter((name) => SETTING_SPECS[name].settable);
const TOGGLEABLE = SETTING_NAMES.filter((name) => SETTING_SPECS[name].is_toggle);

const TEMP_PARAM = { name: "temp", type: "bool", default: false, short: "t", description: "Keep the change only until the browser restarts." } as const;

define("settings.set", {
  name: "set",
  label: "Set a setting",
  intent: "Change a setting and write it to settings.toml. Write set name value to set it, and set name to show it. A list takes one item per word, and [] is the empty list. With --temp, the change lasts only until the browser restarts, and settings.toml is not changed. The consent settings stay in the browser. The site rules change one row at a time from the popup.",
  params: [
    TEMP_PARAM,
    { name: "name", type: "string", values: SETTABLE, strict: true },
    { name: "value", type: "string", rest: true, main: true, optional: true, value_of: "name" },
  ],
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handlers.set(ctx, args as { name: keyof Settings; value: string; temp?: boolean }),
});

define("settings.toggle", {
  name: "toggle",
  label: "Toggle a setting",
  intent: "Flip a true or false setting and write it to settings.toml. With --temp, the change lasts only until the browser restarts, and settings.toml is not changed. The consent settings stay in the browser.",
  params: [TEMP_PARAM, { name: "name", type: "string", main: true, values: TOGGLEABLE, strict: true }],
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handlers.toggle(ctx, args as { name: keyof Settings; temp?: boolean }),
});

define("settings.unset", {
  name: "unset",
  label: "Unset a setting",
  intent: "Remove a setting from settings.toml and its browser edits. The default applies again. Write unset all to drop every browser edit. It leaves settings.toml as it is. With --temp, only the edits that end at a browser restart go.",
  params: [TEMP_PARAM, { name: "name", type: "string", main: true, values: ["all", ...SETTABLE], strict: true }],
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handlers.unset(ctx, args as { name: keyof Settings | "all"; temp?: boolean }),
});
