// The settings page's way to change a setting. It shares `:set`'s planners, check and `change_edits` queue, so a page edit and a `:set` publish the same way.

import { plan_set_value, plan_unset } from "../commands/settings.ts";
import type { ConfigSource } from "./config_load.ts";
import { build_config_status } from "./config_load.ts";
import { build_setting_list } from "../shared/setting_list.ts";
import type { MergedConfig, SettingEdits, Settings } from "../shared/config.ts";
import type { ChangeSetting, ChangeSettingAnswer, ListSettingsAnswer } from "../shared/messages.ts";
import { is_extension_page } from "./extension_page.ts";
import { check_args } from "../shared/registry/check_args.ts";
import { registry } from "../shared/registry/builtin.ts";
import { is_setting_name, SETTING_SPECS } from "../shared/settings_schema.ts";

export type SettingsMessageDeps = {
  change_edits: (decide: (current: SettingEdits, config: MergedConfig) => SettingEdits | undefined) => Promise<void>;
  // The file layer and the stored edits, read fresh.
  read_layers: () => Promise<{ source: ConfigSource; config_settings: MergedConfig["settings"]; edits: SettingEdits }>;
  // The names of the imported themes, which the theme picker lists.
  read_theme_names: () => Promise<string[]>;
};

// The text `:set` or `:unset` gives for a name it does not take, from the same validator.
function refusal_of(command_id: "settings.set" | "settings.unset", name: unknown): string | undefined {
  const checked = check_args(registry.get(command_id)!, { name, ...(command_id === "settings.set" ? { value: "" } : {}) });
  return checked.ok ? undefined : checked.error;
}

const failure = (error: unknown): { ok: false; message: string } => ({ ok: false, message: error instanceof Error ? error.message : String(error) });

export function create_settings_messages(deps: SettingsMessageDeps) {
  // Reads the edits inside the change queue, so a change still writing or rolling back is not shown half done.
  async function list(): Promise<ListSettingsAnswer> {
    try {
      let edits: SettingEdits | undefined;
      await deps.change_edits((current) => {
        edits = current;
        return undefined;
      });
      const { source, config_settings } = await deps.read_layers();
      return { ok: true, settings: build_setting_list(build_config_status(source, config_settings, edits!), await deps.read_theme_names()) };
    } catch (error) {
      return failure(error);
    }
  }

  async function change(request: ChangeSetting): Promise<ChangeSettingAnswer> {
    const { name, action, layer = "saved" } = request;
    if (action !== "set" && action !== "reset") return { ok: false, message: `unknown action ${JSON.stringify(action)}` };
    if (layer !== "saved" && layer !== "temp") return { ok: false, message: `unknown layer ${JSON.stringify(layer)}` };
    const refusal = refusal_of(action === "reset" ? "settings.unset" : "settings.set", name);
    if (refusal !== undefined) return { ok: false, message: refusal };
    if (typeof name !== "string" || !is_setting_name(name)) return { ok: false, message: `unknown setting ${String(name)}` };
    const spec = SETTING_SPECS[name];
    if (action === "set" && !spec.check(request.value)) return { ok: false, message: `${name}: expected ${spec.expectation}` };

    let message = "";
    let final_edits: SettingEdits | undefined;
    try {
      await deps.change_edits((current, config) => {
        const plan = action === "reset" ? plan_unset(name as keyof Settings, false, current) : plan_set_value(name as keyof Settings, request.value, layer, current, config);
        message = plan.toast.message;
        final_edits = plan.next ?? current;
        return plan.next;
      });
      // The row comes from the edits this change left, so a later change in the queue does not alter this reply.
      const { source, config_settings } = await deps.read_layers();
      const status = build_config_status(source, config_settings, final_edits!);
      return { ok: true, setting: build_setting_list(status, await deps.read_theme_names()).find((row) => row.name === name)!, message };
    } catch (error) {
      return failure(error);
    }
  }

  return { list, change };
}
