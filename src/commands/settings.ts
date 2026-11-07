import { show_toast_on_tab } from "../background/browser_deps.ts";
import { change_edits } from "../background/startup.ts";
import type { CommandContext } from "../shared/command.ts";
import { effective_settings } from "../shared/config.ts";
import type { MergedConfig, SettingEdits, SettingOverrides, Settings } from "../shared/config.ts";
import { built_in_theme_names } from "../shared/theme/load.ts";
import { define } from "../shared/registry/builtin.ts";
import { parse_setting_text, SETTING_NAMES, SETTING_SPECS } from "../shared/settings_schema.ts";
import type { ToastKind } from "../shared/messages.ts";

type Toast = { kind: ToastKind; message: string };

// What a `:set`, `:toggle` or `:unset` comes to: the edits to keep (absent for no change) and the toast that answers it.
export type SettingsPlan = { next?: SettingEdits; toast: Toast };

// `saved` lasts. `temp` ends when the browser restarts.
export type EditLayer = "saved" | "temp";

const show = (name: string, value: unknown): string => (value === undefined ? `${name} is not set` : `${name} = ${JSON.stringify(value)}`);

const UNTIL_RESTART = " until the browser restarts";

function without(layer: SettingOverrides, name: keyof Settings): SettingOverrides {
  const { [name]: _removed, ...rest } = layer;
  return rest;
}

// A saved edit drops the temp edit of the same name. Otherwise the temp edit keeps winning and the save shows no effect.
function edit_with(current: SettingEdits, layer: EditLayer, name: keyof Settings, value: unknown): SettingEdits {
  if (layer === "temp") return { saved: current.saved, temp: { ...current.temp, [name]: value } };
  return { saved: { ...current.saved, [name]: value }, temp: without(current.temp, name) };
}

// The build tool only warns about these two, so a live change does the same.
function naming_nothing(name: keyof Settings, value: unknown, config: MergedConfig): string | undefined {
  if (name === "default_engine" && typeof value === "string" && !Object.hasOwn(config.search_engines, value)) return `no search engine is named "${value}"`;
  if (name === "palette" && typeof value === "string" && !built_in_theme_names().includes(value) && config.local_theme?.name !== value) return `no theme is named "${value}"`;
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
  const unmatched = naming_nothing(name, value, config);
  const until = layer === "temp" ? UNTIL_RESTART : "";
  const message = unmatched === undefined ? `${show(name, value)}${until}` : `${show(name, value)}${until}, but ${unmatched}`;
  return { next: edit_with(current, layer, name, value), toast: { kind: unmatched === undefined ? "success" : "warning", message } };
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

export type SettingsDeps = {
  change_edits: (decide: (current: SettingEdits, config: MergedConfig) => SettingEdits | undefined) => Promise<void>;
  toast: (ctx: CommandContext, kind: ToastKind, message: string) => Promise<void>;
};

const layer_of = (temp: boolean | undefined): EditLayer => (temp ? "temp" : "saved");

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
  return {
    set: (ctx: CommandContext, args: { name: keyof Settings; value: string; temp?: boolean }) => apply(ctx, (current, config) => plan_set(args.name, args.value, layer_of(args.temp), current, config)),
    toggle: (ctx: CommandContext, args: { name: keyof Settings; temp?: boolean }) => apply(ctx, (current, config) => plan_toggle(args.name, layer_of(args.temp), current, config)),
    unset: (ctx: CommandContext, args: { name: keyof Settings | "all"; temp?: boolean }) => apply(ctx, (current) => plan_unset(args.name, args.temp === true, current)),
  };
}

const handlers = make_settings_handlers({
  change_edits,
  toast: (ctx, kind, message) => show_toast_on_tab(ctx, "settings", message, kind),
});

const SETTABLE = SETTING_NAMES.filter((name) => SETTING_SPECS[name].settable);
const TOGGLEABLE = SETTING_NAMES.filter((name) => SETTING_SPECS[name].is_toggle);

const TEMP_PARAM = { name: "temp", type: "bool", default: false, short: "t", description: "Keep the change only until the browser restarts." } as const;

define("settings.set", {
  name: "set",
  label: "Set a setting",
  intent: "Change a setting and keep the change. Write set name value to set it, and set name to show it. A list takes one item per word, and [] is the empty list. With --temp, the change lasts only until the browser restarts. The config file is not changed.",
  params: [
    TEMP_PARAM,
    { name: "name", type: "string", values: SETTABLE, strict: true },
    { name: "value", type: "string", rest: true, main: true, optional: true, value_of: "name" },
  ],
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handlers.set(ctx, args as { name: keyof Settings; value: string; temp?: boolean }),
});

define("settings.toggle", {
  name: "toggle",
  label: "Toggle a setting",
  intent: "Flip a true or false setting and keep the change. With --temp, the change lasts only until the browser restarts. The config file is not changed.",
  params: [TEMP_PARAM, { name: "name", type: "string", main: true, values: TOGGLEABLE, strict: true }],
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handlers.toggle(ctx, args as { name: keyof Settings; temp?: boolean }),
});

define("settings.unset", {
  name: "unset",
  label: "Unset a setting",
  intent: "Drop the browser edits of a setting. The config file value applies again. Write unset all to drop every edit. With --temp, only the edits that end at a browser restart go.",
  params: [TEMP_PARAM, { name: "name", type: "string", main: true, values: ["all", ...SETTABLE], strict: true }],
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handlers.unset(ctx, args as { name: keyof Settings | "all"; temp?: boolean }),
});
