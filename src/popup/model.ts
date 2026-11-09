// The rows of the toolbar popup. No DOM, so tests read the rows.

import type { SiteState } from "../background/toolbar.ts";
import { PAGES } from "../help/route.ts";
import { group_of } from "../help/settings_model.ts";

const page_hash = (id: (typeof PAGES)[number]["id"]) => PAGES.find((page) => page.id === id)!.hash;

export const HOME_HASH = page_hash("home");
export const SETTINGS_HASH = page_hash("settings");
// The settings group that lists `site_rules`, as its section slug.
export const SITE_RULES_HASH = `${SETTINGS_HASH.replace("#/", "#section=")}/${group_of("site_rules").toLowerCase()}`;
// The Warnings heading on Home, where the count points.
export const WARNINGS_HASH = "#section=home/warnings";

export type PopupInputs = {
  disabled: boolean;
  site: SiteState;
  warning_count: number;
  version: string;
  has_native_host: boolean;
};

export type PopupRow = {
  id: "power" | "settings" | "home" | "site" | "rule" | "reload_config" | "warnings" | "version";
  kind: "switch" | "link" | "action" | "info";
  label: string;
  // A greyed row says why in `detail`.
  detail?: string;
  enabled: boolean;
  // The switch row only.
  on?: boolean;
  // The site row only: what a click asks for.
  site_action?: "disable" | "enable";
};

function site_row(site: SiteState, disabled: boolean): PopupRow {
  const row = (label: string, enabled: boolean, detail?: string): PopupRow => ({ id: "site", kind: "action", label, enabled, ...(detail === undefined ? {} : { detail }) });
  if (site.kind === "unavailable") return row("Disable on this site", false, "no site on this page");
  if (site.kind === "config") return row("Disable on this site", false, "a rule covers it");
  const site_action = site.kind === "disabled" ? "enable" : "disable";
  const label = site_action === "enable" ? "Enable on this site" : "Disable on this site";
  // Off wins over a disabled site, so the row has no effect to offer.
  return { ...(disabled ? row(label, false, "DesertFox is off") : row(label, true)), site_action };
}

// What a click on the switch asks for: the opposite of what it shows now.
export const disabled_after_click = (power_row: Pick<PopupRow, "on">): boolean => power_row.on === true;

export function build_rows(inputs: PopupInputs): PopupRow[] {
  const rows: PopupRow[] = [
    { id: "power", kind: "switch", label: inputs.disabled ? "DesertFox is off" : "DesertFox is on", enabled: true, on: !inputs.disabled },
    { id: "settings", kind: "link", label: "Settings", enabled: true },
    { id: "home", kind: "link", label: "Help", enabled: true },
    site_row(inputs.site, inputs.disabled),
  ];
  // A rule edit reaches open pages at once. The link opens the settings group that lists them.
  if (inputs.site.kind === "disabled" || inputs.site.kind === "config") rows.push({ id: "rule", kind: "link", label: "Rule on this page", detail: inputs.site.rule, enabled: true });
  rows.push(
    inputs.has_native_host
      ? { id: "reload_config", kind: "action", label: "Reload config", enabled: true }
      : { id: "reload_config", kind: "action", label: "Reload config", detail: "needs the native host", enabled: false },
    { id: "warnings", kind: "link", label: `Warnings (${inputs.warning_count})`, enabled: true },
    { id: "version", kind: "info", label: `Version ${inputs.version}`, enabled: false },
  );
  return rows;
}
