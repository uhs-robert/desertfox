// The "Let this site keep some keys" form of the Your site rules section, apart from the DOM. It holds the site, the keys as chips,
// the pick list and the answer to the last Save, and builds the `{site, pass}` row the background writes.

import { match_regex_source } from "../shared/match_pattern.ts";
import type { SiteRuleRow } from "../shared/match_pattern.ts";
import type { BindingRow, ListBindingsAnswer, SiteKeysRequest, ToolbarAnswer } from "../shared/messages/page.ts";
import { key_column_refusal, pass_row_for, pass_words, site_is_off_for } from "../background/site_keys.ts";
import { site_rule_effects } from "./site_rule_effect.ts";

export type SiteKeysDeps = {
  send: (message: SiteKeysRequest | { type: "list_bindings" }) => Promise<unknown>;
  // The site rules in force, as the Settings page shows them.
  read_rules: () => Promise<SiteRuleRow[]>;
  on_change: () => void;
};

export type PickRow = { keys: string; command: string };

export const SITE_PROBLEM = "Write the site as an address pattern, for example *://*.example.com/*";
export const OFF_NOTE = "This site is off, so the page already gets every key. The keys you keep apply once the site is on again.";

const words_of = (row: SiteRuleRow | undefined): string[] => (row?.pass === undefined ? [] : row.pass.split(/\s+/).filter((word) => word !== ""));

export function create_site_keys_session(deps: SiteKeysDeps) {
  let site = "";
  let chips: string[] = [];
  let text = "";
  let text_problem: string | undefined;
  let text_open = false;
  let filter = "";
  let busy = false;
  let rules: SiteRuleRow[] = [];
  let bindings: PickRow[] = [];
  let message: { ok: boolean; text: string } | undefined;

  const changed = (): void => deps.on_change();
  const existing = (): SiteRuleRow | undefined => pass_row_for(rules, site);
  const site_valid = (): boolean => match_regex_source([site]) !== undefined;
  const joined = (): string => chips.join(" ");

  function set_chips(next: string[]): void {
    chips = [...new Set(next)];
    text = joined();
    text_problem = undefined;
    message = undefined;
  }

  // The form shows the stored row of a pattern as soon as the site field names it.
  function set_site(next: string): void {
    site = next;
    set_chips(words_of(existing()));
    changed();
  }

  async function read_rules(): Promise<void> {
    rules = await deps.read_rules();
  }

  async function read_bindings(): Promise<void> {
    const answer = (await deps.send({ type: "list_bindings" })) as ListBindingsAnswer;
    const seen = new Set<string>();
    bindings = answer.ok ? answer.bindings.filter((row: BindingRow) => row.mode === "normal" && row.text !== "" && !seen.has(row.keys) && seen.add(row.keys)).map((row) => ({ keys: row.keys, command: row.text })) : [];
  }

  // The site is set before the reads, so a key pressed while they run joins the stored keys of the row and is not lost to them.
  async function load(prefill: string | undefined): Promise<void> {
    if (prefill !== undefined) site = prefill;
    const loading_site = site;
    await Promise.all([read_rules(), read_bindings()]);
    if (site === loading_site) set_chips([...words_of(existing()), ...chips]);
    else if (chips.length === 0) set_chips(words_of(existing()));
    changed();
  }

  const differs_from = (row: SiteRuleRow | undefined): boolean => joined() !== words_of(row).join(" ");
  const is_dirty = (): boolean => differs_from(existing());

  // Another tab or a file write changed the rules, or a binding moved. The form keeps what the reader typed unless the row it shows is the one that changed.
  async function refresh(): Promise<void> {
    const before_site = site;
    const before = existing();
    await Promise.all([read_rules(), read_bindings()]);
    const after = existing();
    // A site picked during the reads has its own row, which the baseline says nothing about.
    if (site === before_site && JSON.stringify(after) !== JSON.stringify(before) && !differs_from(before)) set_chips(words_of(after));
    changed();
  }

  const edit = (change: () => void): void => {
    if (busy) return;
    change();
    changed();
  };

  const refusal = (): string | undefined => (site_valid() ? key_column_refusal(rules, site) : undefined);

  const view = () => {
    const blocked = refusal();
    return {
      site,
      chips,
      text,
      text_open,
      text_problem,
      filter,
      busy,
      message,
      site_problem: site === "" || site_valid() ? undefined : SITE_PROBLEM,
      refusal: blocked,
      off_note: site_valid() && site_is_off_for(rules, site) ? OFF_NOTE : undefined,
      effect: chips.length === 0 ? "" : site_rule_effects({ site, pass: joined() }).join("; "),
      has_row: existing() !== undefined,
      picks: bindings.filter((row) => filter.trim() === "" || [row.keys, row.command].some((field) => field.toLowerCase().includes(filter.trim().toLowerCase()))),
      can_save: !busy && site_valid() && chips.length > 0 && text_problem === undefined && blocked === undefined && is_dirty(),
      can_remove: !busy && existing() !== undefined,
    };
  };

  // Busy holds until the rules are read again, so no edit lands between the answer and the form following it.
  async function send_change(keys: string | null): Promise<void> {
    busy = true;
    changed();
    try {
      const answer = (await deps.send({ type: "site_keys", pattern: site, keys })) as ToolbarAnswer;
      await read_rules();
      if (answer.ok && keys === null) set_chips([]);
      message = { ok: answer.ok, text: answer.message };
    } catch (error) {
      // A closed port or a failed listener ends here, so the form says so and the rejection goes nowhere.
      message = { ok: false, text: `Not saved: ${error instanceof Error ? error.message : String(error)}` };
    } finally {
      busy = false;
      changed();
    }
  }

  return {
    view,
    load,
    refresh,
    set_site: (next: string) => edit(() => set_site(next)),
    capture: (token: string) => edit(() => set_chips([...chips, token])),
    capture_backspace: () => edit(() => set_chips(chips.slice(0, -1))),
    remove_chip: (keys: string) => edit(() => set_chips(chips.filter((chip) => chip !== keys))),
    toggle_pick: (keys: string) => edit(() => set_chips(chips.includes(keys) ? chips.filter((chip) => chip !== keys) : [...chips, keys])),
    clear_keys: () => edit(() => set_chips([])),
    set_filter: (next: string) => edit(() => void (filter = next)),
    open_text: (open: boolean) => edit(() => void (text_open = open)),
    // The text fold holds what the chips hold. A line that does not read leaves the chips as they were and says why.
    set_text: (next: string) =>
      edit(() => {
        const checked = next.trim() === "" ? { words: [] } : pass_words(next);
        text = next;
        message = undefined;
        if ("problem" in checked) text_problem = checked.problem;
        else {
          text_problem = undefined;
          chips = checked.words;
        }
      }),
    save: async (): Promise<void> => {
      if (view().can_save) await send_change(joined());
    },
    remove: async (): Promise<void> => {
      if (view().can_remove) await send_change(null);
    },
  };
}

export type SiteKeysSession = ReturnType<typeof create_site_keys_session>;
