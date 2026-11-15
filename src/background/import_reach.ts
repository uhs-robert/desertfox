// What an import can reach, read from the config the preview built: the addresses it adds and the keys that read the clipboard, press keys on a page, change settings or use the native host.
// The Import button stays the one consent. This only shows the reach, so a hostile config cannot hide it in a long file.

import type { CommandMeta, ContextSource } from "../shared/command.ts";
import type { MergedConfig } from "../shared/config.ts";
import { BUILT_IN_PAGE } from "../shared/config.ts";
import type { BoundInvocation, KeyBinding } from "../shared/invocation.ts";
import type { ImportReach, KeyGroup, KeyRow, ReachRow, ReachList } from "../shared/messages.ts";
import { bind_tables_of } from "../shared/match_pattern.ts";
import { is_context_source } from "../shared/registry/params.ts";
import { print_command } from "../shared/registry/print_command.ts";

// Each of these is a consent the user gives on this machine, so a file from elsewhere must not switch it on.
export const CONSENT_SETTINGS = ["bridge", "bridge_share_tabs", "host_auto_update", "newtab_ip_info"] as const;

export const ROW_CAP = 12;

// Commands by what they reach. A test checks that each id is a registered command and that no registered `settings.*`, `native.*` or `permissions.*` command is missing.
const GROUP_PREFIXES: readonly (readonly [KeyGroup, string])[] = [["settings", "settings."], ["host", "native."], ["host", "permissions."]];
const GROUP_IDS: Record<KeyGroup, readonly string[]> = {
  clipboard_or_page: ["page.clipboard", "page.send_key", "open.clipboard"],
  settings: ["settings.set", "settings.toggle", "settings.unset"],
  host: ["native.install", "native.update", "permissions.grant", "text.edit_external", "browser.open_firefox_page", "config.reload", "debug.restart"],
};
export const CLASSIFIED_IDS: readonly string[] = Object.values(GROUP_IDS).flat();
export const CLASSIFIED_PREFIXES: readonly string[] = GROUP_PREFIXES.map(([, prefix]) => prefix);

const group_of_id = (id: string): KeyGroup | undefined => (Object.keys(GROUP_IDS) as KeyGroup[]).find((group) => GROUP_IDS[group].includes(id)) ?? GROUP_PREFIXES.find(([, prefix]) => id.startsWith(prefix))?.[0];

const is_clipboard = (source: ContextSource): boolean => source.from === "clipboard" || source.then === "clipboard";
const reads_clipboard = (value: unknown): boolean => is_context_source(value) && is_clipboard(value);
const WEB_ADDRESS = /^https?:\/\//i;

// An argument that holds an address: a param that takes a URL, or any text that starts with a web scheme.
function addresses_in(command: CommandMeta | undefined, args: Record<string, unknown>): string[] {
  return Object.entries(args).flatMap(([name, value]) => {
    if (typeof value !== "string" || value.trim() === "") return [];
    const param = command?.params?.find((candidate) => candidate.name === name);
    return name === "url" || param?.format === "url" || WEB_ADDRESS.test(value) ? [value] : [];
  });
}

const caps = <T>(): ReachList<T> => ({ rows: [], more: 0 });
function add<T>(list: ReachList<T>, row: T): void {
  if (list.rows.length < ROW_CAP) list.rows.push(row);
  else list.more += 1;
}

// A step that is not an object cannot come out of the build, but the walk skips it instead of trusting that.
const steps_of = (binding: unknown): BoundInvocation[] => [binding].flat().filter((step): step is BoundInvocation => typeof step === "object" && step !== null && typeof (step as BoundInvocation).id === "string");

// The reach of a build that failed: the problems show instead, and the commit refuses.
export const no_reach = (): ImportReach => ({ addresses: caps(), keys: { clipboard_or_page: caps(), settings: caps(), host: caps() }, site_rows: 0 });

export function import_reach(config: MergedConfig, commands: CommandMeta[]): ImportReach {
  const meta = new Map(commands.map((command) => [command.id, command]));
  const addresses: ReachList<ReachRow> = caps();
  const keys: Record<KeyGroup, ReachList<KeyRow>> = { clipboard_or_page: caps(), settings: caps(), host: caps() };
  const default_engine = config.settings.default_engine;

  for (const [name, engine] of Object.entries(config.search_engines)) add(addresses, { what: `Search engine ${name}${name === default_engine ? " (default)" : ""}`, url: engine.url });
  for (const key of ["new_tab_page", "home_page"] as const) {
    const url = config.settings[key];
    if (url !== undefined && url !== BUILT_IN_PAGE) add(addresses, { what: key === "new_tab_page" ? "New tab page" : "Home page", url });
  }
  for (const link of config.settings.newtab_links ?? []) add(addresses, { what: `New tab link ${link.label}`, url: link.url });
  for (const [key, url] of Object.entries(config.quickmarks)) add(addresses, { what: `Quickmark ${key}`, url });

  const walk_binding = (sequence: string, where: string, binding: unknown) => {
    for (const step of steps_of(binding)) {
      const command = meta.get(step.id);
      const args = step.args ?? {};
      const prefill = step.prompt?.prefill;
      const clipboard = Object.values(args).some(reads_clipboard) || (prefill !== undefined && is_clipboard(prefill));
      const group = group_of_id(step.id) ?? (clipboard ? "clipboard_or_page" : undefined);
      for (const url of addresses_in(command, args)) add(addresses, { what: `Key ${sequence} in ${where} opens`, url });
      if (group === undefined) continue;
      const printed_args = step.prompt && prefill !== undefined ? { ...args, [step.prompt.param]: prefill } : args;
      const run = print_command(command ?? { id: step.id }, printed_args, { flags: "long" });
      const names_consent = Object.values(args).some((value) => CONSENT_SETTINGS.some((setting) => setting === value));
      add(keys[group], { where, keys: sequence, run, ...(names_consent ? { names_consent: true as const } : {}) });
    }
  };

  for (const [mode, table] of Object.entries(config.keymap)) {
    if (mode === "search_keys" || mode === "container_keys" || mode === "site_keys" || mode === "modifiers" || mode === "group_names") continue;
    for (const [sequence, binding] of Object.entries(table as Record<string, KeyBinding | null>)) walk_binding(sequence, mode === "browser" ? "Firefox shortcuts" : `${mode} mode`, binding);
  }
  // A modifier adds its args to every key of its group. The build accepts only plain values there, so an address is the one thing it can bring.
  for (const [sequence, { label: _label, ...args }] of Object.entries(config.keymap.modifiers ?? {})) {
    for (const url of addresses_in(undefined, args)) add(addresses, { what: `Modifier ${sequence} adds to its keys`, url });
  }

  let site_rows = 0;
  for (const row of config.settings.site_rules ?? []) {
    const tables = bind_tables_of(row);
    if (tables.length > 0) site_rows += 1;
    for (const { scope, table } of tables) {
      for (const [sequence, binding] of Object.entries(table)) walk_binding(sequence, `site ${row.site}${scope === "" ? "" : `, ${scope.trim()}`}`, binding);
    }
  }

  // An alias runs its command with no args, so only a command that is risky on its own counts.
  for (const [name, id] of Object.entries(config.command_aliases)) {
    const group = group_of_id(id);
    if (group !== undefined) add(keys[group], { where: "command line", keys: `:${name}`, run: id });
  }

  return { addresses, keys, site_rows };
}
