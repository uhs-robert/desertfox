// The on/off switch behind the toolbar popup and its shortcut. Browser access comes in as arguments, so tests run without a browser.

import type { MergedConfig, SettingEdits } from "../shared/config.ts";
import { effective_settings } from "../shared/config.ts";
import { matches_pattern, ignores_any_address } from "../shared/match_pattern.ts";
import { COMPILED_KEYMAP_VERSION } from "../shared/prefix_tree.ts";
import type { ToolbarAnswer, ToolbarRequest } from "../shared/messages.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";

// The manifest `commands` entry that toggles. It is not a slot: no keymap chord reaches it, and it runs while DesertFox is off.
export const TOGGLE_COMMAND = "toggle_enabled";

export const ICON_ON = "icons/desertfox.svg";
export const ICON_OFF = "icons/desertfox-off.svg";

export type ToolbarLook = { path: string; title: string };

export const toolbar_look = (disabled: boolean): ToolbarLook =>
  disabled ? { path: ICON_OFF, title: "DesertFox (off)" } : { path: ICON_ON, title: "DesertFox" };

// What the background publishes in place of the keymap while off. The content script reads it like any tree: no key matches and the
// mode badge is hidden, so no content code knows about the switch.
export const OFF_KEYMAP: CompiledKeymap = { format_version: COMPILED_KEYMAP_VERSION, modes: {}, mode_indicator: "off", which_key_delay_ms: 0 };

export type ToolbarDeps = {
  read_disabled: () => Promise<boolean>;
  write_disabled: (disabled: boolean) => Promise<void>;
  set_look: (look: ToolbarLook) => Promise<void>;
  // Compiles and stores the keymap again. It reads the flag, so it stores the empty keymap while off.
  republish: () => Promise<void>;
  tabs: () => Promise<{ tab_id: number; url: string | undefined }[]>;
  // A tab without a content script rejects. The caller treats that as nothing to do.
  set_tab_mode: (tab_id: number, mode: "normal" | "ignore") => Promise<unknown>;
  ignore_regex: () => Promise<string | undefined>;
};

export function create_toolbar(deps: ToolbarDeps) {
  // Every change runs here one at a time, so a popup click and the shortcut never read the same flag and write the same answer.
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(step: () => Promise<T>): Promise<T> => {
    const run = queue.then(step);
    queue = run.catch(() => undefined);
    return run;
  };

  // Open tabs keep the mode they are in, and the empty keymap alone does not end a hint, command line or insert mode.
  async function leave_modes(): Promise<void> {
    const tabs = await deps.tabs();
    await Promise.all(tabs.map((tab) => deps.set_tab_mode(tab.tab_id, "normal").catch(() => undefined)));
  }

  // The content script decides ignore mode once per page, so the first turn off drops it. Turning on puts it back where the setting says.
  async function restore_ignored(): Promise<void> {
    const source = await deps.ignore_regex();
    if (source === undefined) return;
    const tabs = await deps.tabs();
    await Promise.all(tabs.filter((tab) => ignores_any_address(source, [tab.url])).map((tab) => deps.set_tab_mode(tab.tab_id, "ignore").catch(() => undefined)));
  }

  async function apply(disabled: boolean): Promise<void> {
    const before = await deps.read_disabled();
    await deps.write_disabled(disabled);
    try {
      await deps.republish();
    } catch (error) {
      // A keymap that still says the old state under the new icon would be worse than the failure.
      await deps.write_disabled(before);
      throw error;
    }
    await deps.set_look(toolbar_look(disabled));
    if (disabled) await leave_modes();
    else await restore_ignored();
  }

  return {
    // Run at every background start: Firefox forgets the icon, and the flag is stored.
    sync_look: async (): Promise<void> => deps.set_look(toolbar_look(await deps.read_disabled())),
    set_disabled: (disabled: boolean): Promise<void> => enqueue(() => apply(disabled)),
    toggle: (): Promise<void> => enqueue(async () => apply(!(await deps.read_disabled()))),
  };
}

// The match pattern "Disable on this site" writes: the host without a leading `www.`, with its subdomains. Only web pages have one.
export function site_pattern(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  let address: URL;
  try {
    address = new URL(url);
  } catch {
    return undefined;
  }
  if (address.protocol !== "http:" && address.protocol !== "https:") return undefined;
  const bare = address.hostname.replace(/^www\.(?=.+\.)/, "");
  return bare === "" ? undefined : `*://*.${bare}/*`;
}

// `config` is a pattern in the config file, so only editing the file undoes it.
export type SiteState = { kind: "unavailable" } | { kind: "enabled" | "disabled" | "config"; pattern: string };

export type IgnoreLayers = {
  // The config file's own list.
  file: readonly string[];
  // The saved edit, absent when none was saved.
  saved: readonly string[] | undefined;
  // The list in force, edits included.
  effective: readonly string[];
};

export function site_state(url: string | undefined, layers: IgnoreLayers): SiteState {
  const pattern = site_pattern(url);
  if (pattern === undefined || url === undefined) return { kind: "unavailable" };
  const file_matches = layers.file.some((candidate) => matches_pattern(candidate, url));
  if (layers.saved?.includes(pattern) && !file_matches) return { kind: "disabled", pattern };
  return { kind: layers.effective.some((candidate) => matches_pattern(candidate, url)) ? "config" : "enabled", pattern };
}

// The edits after a site is disabled or enabled, or undefined when nothing changes. The saved list starts as the list in force,
// so the edit keeps the file's patterns.
export function plan_site_edit(current: SettingEdits, config: MergedConfig, pattern: string, action: "disable" | "enable"): SettingEdits | undefined {
  const base = current.saved.ignore_sites ?? effective_settings(config.settings).ignore_sites;
  const listed = base.includes(pattern);
  if (action === "disable" ? listed : !listed) return undefined;
  const next = action === "disable" ? [...base, pattern] : base.filter((candidate) => candidate !== pattern);
  return { ...current, saved: { ...current.saved, ignore_sites: next } };
}

export type ToolbarMessageDeps = {
  toolbar: Pick<ReturnType<typeof create_toolbar>, "set_disabled">;
  change_edits: (decide: (current: SettingEdits, config: MergedConfig) => SettingEdits | undefined) => Promise<void>;
  reload_config: () => Promise<{ config_dir: string; warnings: number }>;
};

const failure = (error: unknown): ToolbarAnswer => ({ ok: false, message: error instanceof Error ? error.message : String(error) });

// The popup's three writes. The request is checked here because a page script can send anything.
export async function answer_toolbar_request(request: ToolbarRequest, deps: ToolbarMessageDeps): Promise<ToolbarAnswer> {
  try {
    if (request.type === "toolbar_set_disabled") {
      if (typeof request.disabled !== "boolean") return { ok: false, message: "disabled must be true or false" };
      await deps.toolbar.set_disabled(request.disabled);
      return { ok: true, message: request.disabled ? "DesertFox is off" : "DesertFox is on" };
    }
    if (request.type === "toolbar_site") {
      const pattern = site_pattern(typeof request.url === "string" ? request.url : undefined);
      if (pattern === undefined) return { ok: false, message: "this page has no site to change" };
      if (request.action !== "disable" && request.action !== "enable") return { ok: false, message: "action must be disable or enable" };
      await deps.change_edits((current, config) => plan_site_edit(current, config, pattern, request.action));
      return { ok: true, message: request.action === "disable" ? "Disabled on this site" : "Enabled on this site" };
    }
    if (request.type === "toolbar_reload_config") {
      const { config_dir, warnings } = await deps.reload_config();
      return { ok: true, message: `Reloaded ${config_dir}, ${warnings} ${warnings === 1 ? "warning" : "warnings"}` };
    }
    return { ok: false, message: "unknown request" };
  } catch (error) {
    return failure(error);
  }
}
