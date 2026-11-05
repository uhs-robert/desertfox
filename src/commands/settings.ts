import { show_toast_on_tab } from "../background/browser_deps.ts";
import { change_overrides } from "../background/startup.ts";
import type { CommandContext } from "../shared/command.ts";
import { effective_settings } from "../shared/config.ts";
import type { MergedConfig, SettingOverrides, Settings } from "../shared/config.ts";
import { built_in_theme_names } from "../shared/mode_colors.ts";
import { define } from "../shared/registry/index.ts";
import { parse_setting_text, SETTING_NAMES, SETTING_SPECS } from "../shared/settings_schema.ts";
import type { ToastKind } from "../shared/messages.ts";

type Toast = { kind: ToastKind; message: string };

// What a `:set`, `:toggle` or `:unset` comes to: the overrides to keep (absent for no change) and the toast that answers it.
export type SettingsPlan = { next?: SettingOverrides; toast: Toast };

const show = (name: string, value: unknown): string => (value === undefined ? `${name} is not set` : `${name} = ${JSON.stringify(value)}`);

// The build tool only warns about these two, so a live change does the same.
function naming_nothing(name: keyof Settings, value: unknown, config: MergedConfig): string | undefined {
  if (name === "default_engine" && typeof value === "string" && !Object.hasOwn(config.search_engines, value)) return `no search engine is named "${value}"`;
  if (name === "palette" && typeof value === "string" && !built_in_theme_names().includes(value) && config.local_theme?.name !== value) return `no theme is named "${value}"`;
  return undefined;
}

// The params already hold valid text: `name` is a known setting that is not a group, and `value` passed that setting's check.
// `config` is the config under the overrides now in force.
export function plan_set(name: keyof Settings, value_text: string, current: SettingOverrides, config: MergedConfig): SettingsPlan {
  const in_force = effective_settings(config.settings)[name];
  if (value_text.trim() === "") return { toast: { kind: "info", message: show(name, in_force) } };
  const { value } = parse_setting_text(name, value_text) as { value: unknown };
  const unmatched = naming_nothing(name, value, config);
  const message = unmatched === undefined ? show(name, value) : `${show(name, value)}, but ${unmatched}`;
  return { next: { ...current, [name]: value }, toast: { kind: unmatched === undefined ? "success" : "warning", message } };
}

export function plan_toggle(name: keyof Settings, current: SettingOverrides, config: MergedConfig): SettingsPlan {
  const flips_from_absent = SETTING_SPECS[name].flips_from_absent as boolean;
  const flipped = !((effective_settings(config.settings)[name] as boolean | undefined) ?? flips_from_absent);
  return { next: { ...current, [name]: flipped }, toast: { kind: "success", message: show(name, flipped) } };
}

export function plan_unset(name: keyof Settings | "all", current: SettingOverrides): SettingsPlan {
  if (name === "all") {
    const count = Object.keys(current).length;
    if (count === 0) return { toast: { kind: "info", message: "No settings are overridden" } };
    return { next: {}, toast: { kind: "success", message: `Cleared ${count} ${count === 1 ? "override" : "overrides"}` } };
  }
  if (!Object.hasOwn(current, name)) return { toast: { kind: "info", message: `${name} is not overridden` } };
  const { [name]: _removed, ...rest } = current;
  return { next: rest, toast: { kind: "success", message: `Unset ${name}` } };
}

export type SettingsDeps = {
  change_overrides: (decide: (current: SettingOverrides, config: MergedConfig) => SettingOverrides | undefined) => Promise<void>;
  toast: (ctx: CommandContext, kind: ToastKind, message: string) => Promise<void>;
};

export function make_settings_handlers(deps: SettingsDeps) {
  // The toast waits for the publish, so a success means the change is in force.
  async function apply(ctx: CommandContext, plan_for: (current: SettingOverrides, config: MergedConfig) => SettingsPlan): Promise<void> {
    const plans: SettingsPlan[] = [];
    await deps.change_overrides((current, config) => {
      const planned = plan_for(current, config);
      plans.push(planned);
      return planned.next;
    });
    const plan = plans.at(-1);
    if (plan) await deps.toast(ctx, plan.toast.kind, plan.toast.message);
  }
  return {
    set: (ctx: CommandContext, args: { name: keyof Settings; value: string }) => apply(ctx, (current, config) => plan_set(args.name, args.value, current, config)),
    toggle: (ctx: CommandContext, args: { name: keyof Settings }) => apply(ctx, (current, config) => plan_toggle(args.name, current, config)),
    unset: (ctx: CommandContext, args: { name: keyof Settings | "all" }) => apply(ctx, (current) => plan_unset(args.name, current)),
  };
}

const handlers = make_settings_handlers({
  change_overrides,
  toast: (ctx, kind, message) => show_toast_on_tab(ctx, "settings", message, kind),
});

// A live change to a group could collide with other keys, so `set` does not take the group names.
const SETTABLE = SETTING_NAMES.filter((name) => !SETTING_SPECS[name].is_group);
const TOGGLEABLE = SETTING_NAMES.filter((name) => SETTING_SPECS[name].flips_from_absent !== undefined);

define("settings.set", {
  name: "set",
  label: "Set a setting",
  intent: "Change a setting until the browser restarts. Write set name value to set it, and set name to show it. A list takes one item per word, and [] is the empty list. The config file is not changed.",
  params: [
    { name: "name", type: "string", values: SETTABLE, strict: true },
    { name: "value", type: "string", rest: true, main: true, optional: true, value_of: "name" },
  ],
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handlers.set(ctx, args as { name: keyof Settings; value: string }),
});

define("settings.toggle", {
  name: "toggle",
  label: "Toggle a setting",
  intent: "Flip a true or false setting until the browser restarts. The config file is not changed.",
  params: [{ name: "name", type: "string", main: true, values: TOGGLEABLE, strict: true }],
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handlers.toggle(ctx, args as { name: keyof Settings }),
});

define("settings.unset", {
  name: "unset",
  label: "Unset a setting",
  intent: "Drop a live setting change. The config file value applies again. Write unset all to drop every change.",
  params: [{ name: "name", type: "string", main: true, values: ["all", ...SETTABLE], strict: true }],
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handlers.unset(ctx, args as { name: keyof Settings | "all" }),
});
