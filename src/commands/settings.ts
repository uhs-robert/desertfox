import { show_toast_on_tab } from "../background/browser_deps.ts";
import { change_overrides } from "../background/startup.ts";
import type { CommandContext } from "../shared/command.ts";
import { effective_settings } from "../shared/config.ts";
import type { MergedConfig, SettingOverrides, Settings } from "../shared/config.ts";
import { built_in_theme_names } from "../shared/mode_colors.ts";
import { define } from "../shared/registry/index.ts";
import { is_setting_name, parse_setting_words, SETTING_SPECS } from "../shared/settings_schema.ts";
import type { ToastKind } from "../shared/messages.ts";

type Toast = { kind: ToastKind; message: string };

// What a typed `:set` or `:unset` comes to: the overrides to keep (absent for no change) and the toast that answers it.
export type SettingsPlan = { next?: SettingOverrides; toast: Toast };

const show = (name: string, value: unknown): string => (value === undefined ? `${name} is not set` : `${name} = ${JSON.stringify(value)}`);

// `name`, `name=value`, `name!` or `name value words`. The value keeps its inner spacing: the parser joins the words of a quoted value with single spaces.
function split_setting_text(text: string): { name: string; flips: boolean; value_text: string } {
  const trimmed = text.trimStart();
  const name_end = trimmed.search(/[\s=]/);
  const name = name_end < 0 ? trimmed : trimmed.slice(0, name_end);
  const value_text = name_end < 0 ? "" : trimmed.slice(name_end + (trimmed[name_end] === "=" ? 1 : 0)).trimStart();
  return name.endsWith("!") && value_text === "" ? { name: name.slice(0, -1), flips: true, value_text } : { name, flips: false, value_text };
}

function known_setting(name: string): keyof Settings {
  if (!is_setting_name(name)) throw new Error(`Unknown setting "${name}". The command line completes the names`);
  return name;
}

// The build tool only warns about these two, so a live change does the same.
function naming_nothing(name: keyof Settings, value: unknown, config: MergedConfig): string | undefined {
  if (name === "default_engine" && typeof value === "string" && !Object.hasOwn(config.search_engines, value)) return `no search engine is named "${value}"`;
  if (name === "palette" && typeof value === "string" && !built_in_theme_names().includes(value) && config.local_theme?.name !== value) return `no theme is named "${value}"`;
  return undefined;
}

// Throws the message of a refusal. `config` is the config under the overrides now in force.
export function plan_set(text: string, current: SettingOverrides, config: MergedConfig): SettingsPlan {
  const { name: typed_name, flips, value_text } = split_setting_text(text);
  if (typed_name === "") throw new Error("Name a setting, for example `set which_key_delay_ms 500`");
  const name = known_setting(typed_name);
  const spec = SETTING_SPECS[name];
  if (spec.is_group) throw new Error(`${name} is a group of keys. Set it in settings.toml: a live change could collide with other keys`);
  const in_force = effective_settings(config.settings)[name];

  if (flips) {
    if (spec.flips_from_absent === undefined) throw new Error(`${name} is not a true or false setting, so ! cannot flip it`);
    const flipped = !((in_force as boolean | undefined) ?? spec.flips_from_absent);
    return { next: { ...current, [name]: flipped }, toast: { kind: "success", message: show(name, flipped) } };
  }
  if (value_text === "") return { toast: { kind: "info", message: show(name, in_force) } };

  const parsed = parse_setting_words(name, spec.is_list ? value_text.split(/\s+/) : [value_text]);
  if ("error" in parsed) throw new Error(parsed.error);
  const unmatched = naming_nothing(name, parsed.value, config);
  const message = unmatched === undefined ? show(name, parsed.value) : `${show(name, parsed.value)}, but ${unmatched}`;
  return { next: { ...current, [name]: parsed.value }, toast: { kind: unmatched === undefined ? "success" : "warning", message } };
}

export function plan_unset(text: string, current: SettingOverrides): SettingsPlan {
  const names = text.trim().split(/\s+/).filter((word) => word !== "");
  if (names.length === 0) return { toast: { kind: "info", message: "Name a setting to unset, or all" } };
  if (names.length > 1) throw new Error("unset takes one setting name, or all");
  const [name] = names as [string];
  if (name === "all") {
    const count = Object.keys(current).length;
    if (count === 0) return { toast: { kind: "info", message: "No settings are overridden" } };
    return { next: {}, toast: { kind: "success", message: `Cleared ${count} ${count === 1 ? "override" : "overrides"}` } };
  }
  const setting = known_setting(name);
  if (!Object.hasOwn(current, setting)) return { toast: { kind: "info", message: `${setting} is not overridden` } };
  const { [setting]: _removed, ...rest } = current;
  return { next: rest, toast: { kind: "success", message: `Unset ${setting}` } };
}

export type SettingsDeps = {
  change_overrides: (decide: (current: SettingOverrides, config: MergedConfig) => SettingOverrides | undefined) => Promise<void>;
  toast: (ctx: CommandContext, kind: ToastKind, message: string) => Promise<void>;
};

export function make_settings_handlers(deps: SettingsDeps) {
  // The toast waits for the publish, so a success means the change is in force.
  async function apply(ctx: CommandContext, plan_for: (current: SettingOverrides, config: MergedConfig) => SettingsPlan): Promise<void> {
    let plan: SettingsPlan | undefined;
    await deps.change_overrides((current, config) => {
      plan = plan_for(current, config);
      return plan.next;
    });
    if (plan) await deps.toast(ctx, plan.toast.kind, plan.toast.message);
  }
  return {
    set: (ctx: CommandContext, args: { setting: string }) => apply(ctx, (current, config) => plan_set(args.setting, current, config)),
    unset: (ctx: CommandContext, args: { setting: string }) => apply(ctx, (current) => plan_unset(args.setting, current)),
  };
}

const handlers = make_settings_handlers({
  change_overrides,
  toast: (ctx, kind, message) => show_toast_on_tab(ctx, "settings", message, kind),
});

define("settings.set", {
  name: "set",
  label: "Set a setting",
  intent: "Change a setting until the browser restarts. Write set name value or set name=value to set it, set name to show it and set name! to flip a true or false setting. A list takes one item per word. The config file is not changed.",
  params: [{ name: "setting", type: "string", rest: true, main: true, default: "" }],
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handlers.set(ctx, args as { setting: string }),
});

define("settings.unset", {
  name: "unset",
  label: "Unset a setting",
  intent: "Drop a live setting change. The config file value applies again. Write unset all to drop every change.",
  params: [{ name: "setting", type: "string", rest: true, main: true, default: "" }],
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handlers.unset(ctx, args as { setting: string }),
});
