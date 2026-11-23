import { show_toast_on_tab } from "../background/browser_deps.ts";
import { change_edits, get_config, set_in_settings_file, toggle_in_settings_file, unset_in_settings_file } from "../background/config_main.ts";
import { outcome_kind, outcome_note, unset_toast } from "../background/settings_file.ts";
import type { FileWriteOutcome, UnsetResult } from "../background/settings_file.ts";
import type { CommandContext } from "../shared/command.ts";
import type { MergedConfig, SettingEdits, Settings } from "../shared/config.ts";
import { plan_set, plan_toggle, plan_unset, set_toast, show } from "../shared/settings_plan.ts";
import type { EditLayer, SettingsPlan } from "../shared/settings_plan.ts";
import { define } from "../shared/registry/builtin.ts";
import { FILE_WRITTEN_SETTINGS, parse_setting_text, SETTING_NAMES, SETTING_SPECS } from "../shared/settings_schema.ts";
import type { ToastKind } from "../shared/messages/tab.ts";
import type { TomlValue } from "../background/toml_key_edit.ts";

export type SettingsDeps = {
  change_edits: (decide: (current: SettingEdits, config: MergedConfig) => SettingEdits | undefined) => Promise<void>;
  toast: (ctx: CommandContext, kind: ToastKind, message: string) => Promise<void>;
  // The settings.toml writes of `config_setting_writes.ts`, for the names in `FILE_WRITTEN_SETTINGS` without `--temp`.
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

// The one narrowing: `SETTABLE` is filtered at run time, so its names type as `string`. The param is strict, so the validator has already refused any name outside the list.
const setting_named = <N extends string, A extends { name: string }>(args: A) => args as A & { name: N };

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
  run: (ctx, args) => handlers.set(ctx, setting_named(args)),
});

define("settings.toggle", {
  name: "toggle",
  label: "Toggle a setting",
  intent: "Flip a true or false setting and write it to settings.toml. With --temp, the change lasts only until the browser restarts, and settings.toml is not changed. The consent settings stay in the browser.",
  params: [TEMP_PARAM, { name: "name", type: "string", main: true, values: TOGGLEABLE, strict: true }],
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handlers.toggle(ctx, setting_named(args)),
});

define("settings.unset", {
  name: "unset",
  label: "Unset a setting",
  intent: "Remove a setting from settings.toml and its browser edits. The default applies again. Write unset all to drop every browser edit. It leaves settings.toml as it is. With --temp, only the edits that end at a browser restart go.",
  params: [TEMP_PARAM, { name: "name", type: "string", main: true, values: ["all", ...SETTABLE], strict: true }],
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handlers.unset(ctx, setting_named(args)),
});
