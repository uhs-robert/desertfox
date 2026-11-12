// The on/off switch behind the toolbar popup and its shortcut. Browser access comes in as arguments, so tests run without a browser.

import type { MergedConfig, SettingEdits } from "../shared/config.ts";
import { matches_pattern, resolve_site_columns, site_row_columns, type ResolvedSiteColumns, type SiteRowKeys, type SiteRuleRow } from "../shared/match_pattern.ts";
import { COMPILED_KEYMAP_VERSION } from "../shared/prefix_tree.ts";
import type { ToolbarAnswer, ToolbarRequest } from "../shared/messages.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import { DEFAULT_TOAST_ERROR_MS, DEFAULT_TOAST_MS } from "../shared/default_settings.ts";

// The manifest `commands` entry that toggles. It is not a slot: no keymap chord reaches it, and it runs while DesertFox is off.
export const TOGGLE_COMMAND = "toggle_enabled";

export const ICON_ON = "icons/desertfox.svg";
export const ICON_OFF = "icons/desertfox-off.svg";

export type ToolbarLook = { path: string; title: string };

export const toolbar_look = (disabled: boolean): ToolbarLook =>
  disabled ? { path: ICON_OFF, title: "DesertFox (off)" } : { path: ICON_ON, title: "DesertFox" };

// What the background publishes in place of the keymap while off. The content script reads it like any tree: no key matches and the
// mode badge is hidden. Only `off` is read by name, so a lone keyup passes.
export const OFF_KEYMAP: CompiledKeymap = { format_version: COMPILED_KEYMAP_VERSION, modes: {}, off: true, mode_indicator: "off", which_key_delay_ms: 0, toast_ms: DEFAULT_TOAST_MS, toast_error_ms: DEFAULT_TOAST_ERROR_MS };

export type ToolbarDeps = {
  read_disabled: () => Promise<boolean>;
  write_disabled: (disabled: boolean) => Promise<void>;
  set_look: (look: ToolbarLook) => Promise<void>;
  // Compiles and stores the keymap again. It reads the flag, so it stores the empty keymap while off.
  republish: () => Promise<void>;
  tabs: () => Promise<{ tab_id: number; url: string | undefined }[]>;
  // A tab without a content script rejects. The caller treats that as nothing to do.
  set_tab_mode: (tab_id: number, mode: "normal") => Promise<unknown>;
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

  async function apply(disabled: boolean): Promise<void> {
    const before = await deps.read_disabled();
    if (before === disabled) return;
    await deps.write_disabled(disabled);
    try {
      await deps.republish();
    } catch (error) {
      // A keymap that still says the old state under the new icon would be worse than the failure.
      await deps.write_disabled(before);
      throw error;
    }
    await deps.set_look(toolbar_look(disabled));
    // Turning on needs no step: the content script sees the stored tree change and enters ignore mode on an all-off rule.
    if (disabled) await leave_modes();
  }

  return {
    // Run at every background start: Firefox forgets the icon, and the flag is stored.
    sync_look: (): Promise<void> => enqueue(async () => deps.set_look(toolbar_look(await deps.read_disabled()))),
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

// `disabled` is an off row this popup wrote, which a click can remove. `config` is a page whose off column another row decides, so only editing the settings changes it.
// `rule` words what the matching rows do to this page, and is absent when no row matches.
export type SiteState = { kind: "unavailable" } | { kind: "enabled" | "disabled" | "config"; pattern: string; rule?: string };

export type SiteRuleLayers = {
  // The config file's own rules.
  file: readonly SiteRuleRow[];
  // The saved edit, absent when none was saved.
  saved: readonly SiteRuleRow[] | undefined;
  // The rules in force, edits included.
  effective: readonly SiteRuleRow[];
};

// The row the popup writes for a pattern: off and nothing else. A bare row of an older popup counts too, since it loads as off.
const is_popup_row = (pattern: string) => (row: SiteRuleRow): boolean => {
  const { off, keys, values } = site_row_columns(row);
  return row.site === pattern && off === true && keys === undefined && values === undefined && row.bind === undefined;
};

const columns_at = (rows: readonly SiteRuleRow[], url: string): ResolvedSiteColumns<SiteRowKeys> =>
  resolve_site_columns(rows.filter((row) => matches_pattern(row.site, url)).map(site_row_columns));

const key_count = (keys: string): number => keys.split(/\s+/).filter((word) => word !== "").length;
const plural = (count: number): string => `${count} ${count === 1 ? "key" : "keys"}`;

// "all off", or what is set among "on", the key rule and the per-site values, for example "on, pass 3 keys".
export function describe_columns(columns: ResolvedSiteColumns<SiteRowKeys>): string | undefined {
  if (columns.off === true) return "all off";
  const keys = columns.keys === undefined ? [] : ["pass" in columns.keys ? `pass ${plural(key_count(columns.keys.pass))}` : `only ${plural(key_count(columns.keys.only))}`];
  const parts = [...(columns.off === false ? ["on"] : []), ...keys, ...Object.entries(columns.values).map(([name, value]) => `${name} ${String(value)}`)];
  return parts.length > 0 ? parts.join(", ") : undefined;
}

// The popup can turn a site off only while no row sets the off column: its appended row then decides it.
// It can turn a site on again only while its own saved row decides the column and no other row would.
export function site_state(url: string | undefined, layers: SiteRuleLayers): SiteState {
  const pattern = site_pattern(url);
  if (pattern === undefined || url === undefined) return { kind: "unavailable" };
  const columns = columns_at(layers.effective, url);
  const rule = describe_columns(columns);
  const state = { pattern, ...(rule === undefined ? {} : { rule }) };
  if (columns.off === undefined) return { kind: "enabled", ...state };
  const own = is_popup_row(pattern);
  // A popup row the file also holds is the file's: removing it from the saved list would drop a file rule.
  const popup_decides = columns.off && (layers.saved?.some(own) ?? false) && !layers.file.some(own) && columns_at(layers.effective.filter((row) => !own(row)), url).off === undefined;
  return { kind: popup_decides ? "disabled" : "config", ...state };
}

// The edits after a site is disabled or enabled, or undefined when nothing changes. The saved list starts as the config file's list,
// so the edit keeps the file's rules. Disabling appends an off row, and enabling removes the popup's off rows for the pattern.
export function plan_site_edit(current: SettingEdits, file_rules: readonly SiteRuleRow[], pattern: string, action: "disable" | "enable"): SettingEdits | undefined {
  // Never the list in force: that would copy a `:set --temp` into the saved layer.
  const base = current.saved.site_rules ?? file_rules;
  const own = is_popup_row(pattern);
  const listed = base.some(own);
  if (action === "disable" ? listed : !listed) return undefined;
  const next = action === "disable" ? [...base, { site: pattern, off: true }] : base.filter((row) => !own(row));
  return { ...current, saved: { ...current.saved, site_rules: next } };
}

export type ToolbarMessageDeps = {
  toolbar: Pick<ReturnType<typeof create_toolbar>, "set_disabled">;
  change_edits: (decide: (current: SettingEdits, config: MergedConfig) => SettingEdits | undefined) => Promise<void>;
  // The config file's own `site_rules`.
  read_file_site_rules: () => Promise<readonly SiteRuleRow[]>;
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
      const file_rules = await deps.read_file_site_rules();
      await deps.change_edits((current) => plan_site_edit(current, file_rules, pattern, request.action));
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
