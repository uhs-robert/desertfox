// The settings page's way to change a setting. It shares `:set`'s planners, check and `change_edits` queue, so a page edit and a `:set` publish the same way.

import { plan_set_value, plan_unset } from "../commands/settings.ts";
import type { ConfigSource } from "./config_load.ts";
import { build_config_status } from "./config_load.ts";
import { build_setting_list } from "../help/config_view.ts";
import type { MergedConfig, SettingEdits, Settings } from "../shared/config.ts";
import type { ChangeSetting, ChangeSettingAnswer, ListSettingsAnswer } from "../shared/messages.ts";
import { check_args } from "../shared/registry/check_args.ts";
import { registry } from "../shared/registry/index.ts";
import { is_setting_name, SETTING_SPECS } from "../shared/settings_schema.ts";

export type SettingsMessageDeps = {
  change_edits: (decide: (current: SettingEdits, config: MergedConfig) => SettingEdits | undefined) => Promise<void>;
  // The file layer and the stored edits, read fresh.
  read_layers: () => Promise<{ source: ConfigSource; config_settings: MergedConfig["settings"]; edits: SettingEdits }>;
};

// Only a top-level extension page may ask. `cmdline.html` is web-accessible, so a site can embed it in a frame, and a content script runs under the site's address.
export function is_extension_page(sender: { id?: string | undefined; url?: string | undefined; frameId?: number | undefined; tab?: { url?: string | undefined } | undefined }, extension_id: string, origin: string): boolean {
  const under_origin = (url: string | undefined) => url !== undefined && url.startsWith(origin);
  return sender.id === extension_id && under_origin(sender.url) && (sender.frameId ?? 0) === 0 && (sender.tab === undefined || under_origin(sender.tab.url));
}

// The text `:set` or `:unset` gives for a name it does not take, from the same validator.
function refusal_of(command_id: "settings.set" | "settings.unset", name: unknown): string | undefined {
  const checked = check_args(registry.get(command_id)!, { name, ...(command_id === "settings.set" ? { value: "" } : {}) });
  return checked.ok ? undefined : checked.error;
}

export function create_settings_messages(deps: SettingsMessageDeps) {
  async function list(): Promise<ListSettingsAnswer> {
    const { source, config_settings, edits } = await deps.read_layers();
    return { ok: true, settings: build_setting_list(build_config_status(source, config_settings, edits, "")) };
  }

  async function change(request: ChangeSetting): Promise<ChangeSettingAnswer> {
    const { name, action } = request;
    const refusal = refusal_of(action === "reset" ? "settings.unset" : "settings.set", name);
    if (refusal !== undefined) return { ok: false, message: refusal };
    if (typeof name !== "string" || !is_setting_name(name)) return { ok: false, message: `unknown setting ${String(name)}` };
    const spec = SETTING_SPECS[name];
    if (action === "set" && !spec.check(request.value)) return { ok: false, message: `${name}: expected ${spec.expectation}` };

    const layer = request.layer === "temp" ? "temp" : "saved";
    let message = "";
    let final_edits: SettingEdits | undefined;
    await deps.change_edits((current, config) => {
      const plan = action === "reset" ? plan_unset(name as keyof Settings, false, current) : plan_set_value(name as keyof Settings, request.value, layer, current, config);
      message = plan.toast.message;
      final_edits = plan.next ?? current;
      return plan.next;
    });
    // The row comes from the edits this change left, so a later change in the queue does not alter this reply.
    const { source, config_settings } = await deps.read_layers();
    const status = build_config_status(source, config_settings, final_edits!, "");
    return { ok: true, setting: build_setting_list(status).find((row) => row.name === name)!, message };
  }

  return { list, change };
}
