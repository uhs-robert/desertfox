// The rows of the toolbar popup. No DOM, so tests read the rows.

import type { SiteState } from "../background/toolbar.ts";
import { PAGES } from "../help/route.ts";
import { BUILT_IN_THEME_NAMES } from "../shared/theme_names.ts";
import { REPO } from "../shared/native_host.ts";
import type { ToolbarAnswer } from "../shared/messages.ts";
import { DESKTOP_THEME } from "../shared/theme/roles.ts";

const page_hash = (id: (typeof PAGES)[number]["id"]) => PAGES.find((page) => page.id === id)!.hash;

export const HOME_HASH = page_hash("home");
export const SETTINGS_HASH = page_hash("settings");
export const COMMANDS_HASH = page_hash("commands");
// The file editor under the settings page's Advanced section. A test keeps the slug in step with the page, which this file cannot import.
export const EDIT_FILES_HASH = "#section=settings/advanced-edit-files";
// The settings page draws an empty anchor with the id `settings-site-rules` at the top of the General rows, because the rows load after the route lands. A test keeps the slug in step with the page, which this file cannot import.
export const SITE_RULES_HASH = "#section=settings/site-rules";
// The Warnings heading on Home, where the count points.
export const WARNINGS_HASH = "#section=home/warnings";

export const SUPPORT_URL = "https://github.com/sponsors/uhs-robert";

// A release version has three parts (1.0.0) and a tag of its own. A beta has a fourth (1.0.0.53), and its release body is one boilerplate line, so it links to the list.
export function release_url(version: string): string {
  const releases = `https://github.com/${REPO}/releases`;
  return /^\d+\.\d+\.\d+$/.test(version) ? `${releases}/tag/v${version}` : releases;
}

// The rule the copy button puts on the clipboard: a `site_rules` row for the pattern with `pass` empty, for the user to fill in.
export const rule_template = (pattern: string): string => `[[site_rules]]\nsite = "${pattern}"\npass = ""\n`;

// `desktop` (follow the desktop's pushed theme), the built-in, local and imported themes, once each and sorted, plus the one in force so the list never lacks it.
export function theme_options(current: string, extra_names: readonly string[]): string[] {
  return [...new Set([current, DESKTOP_THEME, ...BUILT_IN_THEME_NAMES, ...extra_names])].sort();
}

export type HostDot = { connected: boolean; label: string };

export function host_dot(has_native_host: boolean, host_connected: boolean): HostDot {
  if (!has_native_host) return { connected: false, label: "Native host: no permission" };
  return host_connected ? { connected: true, label: "Native host: connected" } : { connected: false, label: "Native host: not connected" };
}

// How long a success notice stays. An error notice stays until the next action.
export const NOTICE_MS = 4000;

// The notice line. Each notice holds the timer of its own, and a newer notice cancels the older timer, so an old timer never clears a new line.
export function create_notice(deps: { after: (run: () => void, delay_ms: number) => () => void; changed: () => void }) {
  let text = "";
  let cancel: (() => void) | undefined;
  return {
    text: (): string => text,
    show(answer: ToolbarAnswer): void {
      cancel?.();
      cancel = undefined;
      text = answer.message;
      if (answer.ok) {
        const mine = text;
        cancel = deps.after(() => {
          if (text !== mine) return;
          text = "";
          cancel = undefined;
          deps.changed();
        }, NOTICE_MS);
      }
    },
  };
}

export type PopupInputs = {
  disabled: boolean;
  site: SiteState;
  warning_count: number;
  version: string;
  has_native_host: boolean;
  // The bridge port is up and the host has said ready.
  host_connected: boolean;
  // Names of the local and imported themes, and the theme in force.
  extra_theme_names: readonly string[];
  theme: string;
};

export type PopupRow = {
  id: "power" | "settings" | "home" | "support" | "site" | "rule" | "reload_config" | "warnings" | "copy_rule" | "keys";
  kind: "switch" | "link" | "action";
  label: string;
  // A greyed row says why in `detail`.
  detail?: string;
  enabled: boolean;
  // The switch row only.
  on?: boolean;
  // The site row only: what a click asks for.
  site_action?: "disable" | "enable";
};

export type SiteCard = { host: string; state: string };

// The card's two lines: the host the rows cover (the pattern without its wildcards) and one word of state, with the reason where a button is grey.
export function site_card(site: SiteState, disabled: boolean): SiteCard {
  if (site.kind === "unavailable") return { host: "This page", state: "No site on this page" };
  const host = site.pattern.replace(/^\*:\/\/\*\./, "").replace(/\/\*$/, "");
  if (disabled) return { host, state: "DesertFox is off" };
  if (site.kind === "config") return { host, state: "A rule covers this site" };
  return { host, state: site.kind === "disabled" ? "Disabled on this site" : "Enabled on this site" };
}

function site_row(site: SiteState, disabled: boolean): PopupRow {
  const row = (label: string, enabled: boolean, detail?: string): PopupRow => ({ id: "site", kind: "action", label, enabled, ...(detail === undefined ? {} : { detail }) });
  if (site.kind === "unavailable") return row("Disable on this site", false, "No site on this page");
  if (site.kind === "config") return row("Disable on this site", false, "A rule covers it");
  const site_action = site.kind === "disabled" ? "enable" : "disable";
  const label = site_action === "enable" ? "Enable on this site" : "Disable on this site";
  // Off wins over a disabled site, so the row has no effect to offer.
  return { ...(disabled ? row(label, false, "DesertFox is off") : row(label, true)), site_action };
}

const sentence_case = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

// What a click on the switch asks for: the opposite of what it shows now.
export const disabled_after_click = (power_row: Pick<PopupRow, "on">): boolean => power_row.on === true;

export function build_rows(inputs: PopupInputs): PopupRow[] {
  const rows: PopupRow[] = [
    { id: "power", kind: "switch", label: inputs.disabled ? "DesertFox is off" : "DesertFox is on", enabled: true, on: !inputs.disabled },
    site_row(inputs.site, inputs.disabled),
  ];
  // A rule edit reaches open pages at once. The link opens the settings group that lists them.
  if (inputs.site.kind !== "unavailable" && inputs.site.rule !== undefined) rows.push({ id: "rule", kind: "link", label: "Rule on this page", detail: sentence_case(inputs.site.rule), enabled: true });
  if (inputs.site.kind !== "unavailable") rows.push({ id: "copy_rule", kind: "action", label: "Copy rule", enabled: true });
  rows.push(
    inputs.has_native_host
      ? { id: "reload_config", kind: "action", label: "Reload config", enabled: true }
      : { id: "reload_config", kind: "action", label: "Reload config", detail: "Needs the native host", enabled: false },
    { id: "settings", kind: "link", label: "Settings", enabled: true },
    { id: "home", kind: "link", label: "Help", enabled: true },
    { id: "keys", kind: "link", label: "Keys", enabled: true },
  );
  // Warnings is a problem list, so it shows only when there is something in it.
  if (inputs.warning_count > 0) rows.push({ id: "warnings", kind: "link", label: `Warnings (${inputs.warning_count})`, enabled: true });
  rows.push({ id: "support", kind: "link", label: "Support DesertFox", enabled: true });
  return rows;
}
