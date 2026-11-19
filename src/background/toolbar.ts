// The on/off switch behind the toolbar popup and its shortcut. Browser access comes in as arguments, so tests run without a browser.

import { matches_pattern, resolve_site_columns, site_row_columns, type ResolvedSiteColumns, type SiteRowKeys, type SiteRuleRow } from "../shared/match_pattern.ts";
import { COMPILED_KEYMAP_VERSION } from "../shared/prefix_tree.ts";
import type { ToolbarAnswer, ToolbarRequest } from "../shared/messages.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import { DEFAULT_TOAST_ERROR_MS, DEFAULT_TOAST_MS } from "../shared/default_settings.ts";
import { best_effort, keep_chain } from "../shared/swallow.ts";

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
    queue = keep_chain(run);
    return run;
  };

  // Open tabs keep the mode they are in, and the empty keymap alone does not end a hint, command line or insert mode.
  async function leave_modes(): Promise<void> {
    const tabs = await deps.tabs();
    await Promise.all(tabs.map((tab) => best_effort(deps.set_tab_mode(tab.tab_id, "normal"))));
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

// `disabled` is an off row this popup writes, which a click can remove. `config` is a page whose off column another row decides, so only editing the settings changes it.
// `rule` words what the matching rows do to this page, and is absent when no row matches.
export type SiteState = { kind: "unavailable" } | { kind: "enabled" | "disabled" | "config"; pattern: string; rule?: string };

// The row the popup writes: a site that is off and nothing else. Any other column makes the row the user's,
// so it checks every key of the row instead of a column list that a new column would slip past.
const is_popup_shaped = (row: SiteRuleRow): boolean =>
  (row.off === true || row.off === undefined) && Object.entries(row).every(([name, value]) => name === "site" || name === "off" || value === undefined);

const is_popup_row = (pattern: string) => (row: SiteRuleRow): boolean => row.site === pattern && is_popup_shaped(row);

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
// It can turn a site on again only while a popup row for the pattern decides the column and no other row decides it the same way. `rules` are the rules in force.
export function site_state(url: string | undefined, rules: readonly SiteRuleRow[]): SiteState {
  const pattern = site_pattern(url);
  if (pattern === undefined || url === undefined) return { kind: "unavailable" };
  const columns = columns_at(rules, url);
  const rule = describe_columns(columns);
  const state = { pattern, ...(rule === undefined ? {} : { rule }) };
  if (columns.off === undefined) return { kind: "enabled", ...state };
  const own = is_popup_row(pattern);
  const popup_decides = columns.off && rules.some(own) && columns_at(rules.filter((row) => !own(row)), url).off === undefined;
  return { kind: popup_decides ? "disabled" : "config", ...state };
}

// Whether `rules` turn the page at `url` off: the first matching row that sets the off column decides.
export const site_is_off = (rules: readonly SiteRuleRow[], url: string): boolean => columns_at(rules, url).off === true;

// The rows after a site is disabled or enabled, or undefined when nothing changes. Disabling appends an off row, and enabling removes every popup row for the pattern.
export function site_rows_after(rows: readonly SiteRuleRow[], pattern: string, action: "disable" | "enable"): SiteRuleRow[] | undefined {
  const own = is_popup_row(pattern);
  const listed = rows.some(own);
  if (action === "disable" ? listed : !listed) return undefined;
  return action === "disable" ? [...rows, { site: pattern, off: true }] : rows.filter((row) => !own(row));
}

// The popup rows of a list saved in the browser before the popup wrote settings.toml, which the file lacks. They go into the file on the popup's next write.
// The saved list's other rows are copies of file rows taken when the popup first wrote, so the file's own rows, edits since included, stand for them.
export function saved_popup_rows(file_rows: readonly SiteRuleRow[], saved: readonly SiteRuleRow[] | undefined): SiteRuleRow[] {
  return (saved ?? []).filter((row) => is_popup_shaped(row) && !file_rows.some((file_row) => is_popup_shaped(file_row) && file_row.site === row.site));
}

export type ToolbarMessageDeps = {
  toolbar: Pick<ReturnType<typeof create_toolbar>, "set_disabled">;
  // Writes the popup's row change for the page at `url` into settings.toml (`change_site_rule_in_file`), and gives back what became of the file as a note for the answer.
  change_site_rule: (url: string, action: "disable" | "enable") => Promise<string>;
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
      const note = await deps.change_site_rule(request.url as string, request.action);
      return { ok: true, message: `${request.action === "disable" ? "Disabled on this site" : "Enabled on this site"}${note}` };
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
