// The settings page without a DOM: which control each setting gets, the checks as you type, and the session that sends changes and absorbs refreshes. Tests read this module.

import type { ChangeSetting, ChangeSettingAnswer, ListSettings, ListSettingsAnswer, SettingListRow } from "../shared/messages.ts";
import type { SettingTag } from "../shared/setting_list.ts";
import { SETTING_DOCS } from "../shared/settings_docs.ts";
import { is_setting_name, SETTING_SPECS } from "../shared/settings_schema.ts";

// Shown on a row `:set` refuses.
export const READ_ONLY_NOTE = ":set does not take this setting. Edit it in the config file, then run config.reload.";

// A group takes the settings whose name starts with one of its prefixes. A setting that matches none lands in the last group.
export const GROUPS: { title: string; prefixes: string[] }[] = [
  { title: "Appearance", prefixes: ["palette", "light_", "mode_indicator", "which_key_"] },
  { title: "New tab", prefixes: ["newtab_", "new_tab_page", "home_page"] },
  { title: "Search", prefixes: ["default_engine", "search_", "container_"] },
  { title: "Command line and completion", prefixes: ["cmdline_", "completion_", "open_completion", "history_completion_"] },
  { title: "General", prefixes: [] },
];

export function group_of(name: string): string {
  return (GROUPS.find((group) => group.prefixes.some((prefix) => name.startsWith(prefix))) ?? GROUPS.at(-1)!).title;
}

// What the page draws for a setting.
export type Control =
  | { type: "checkbox" }
  // `options` are typed, so a number or boolean option goes back to the background with its type.
  | { type: "select"; options: unknown[] }
  | { type: "number" }
  // `suggestions` fill a datalist. They are not a limit.
  | { type: "text"; suggestions: string[] }
  | { type: "text_list" }
  // The order of the checked items is the value's order, so each item has up and down buttons.
  | { type: "ordered_list"; items: string[] }
  | { type: "read_only" };

// `engines` are the names `default_engine` can take. A value in force that no option names stays selectable, so the control never shows something the setting does not hold.
export function control_of(row: SettingListRow, engines: string[]): Control {
  if (!row.settable) return { type: "read_only" };
  const keep_current = (options: unknown[]) => (row.value === undefined || options.some((option) => option === row.value) ? options : [...options, row.value]);
  switch (row.kind) {
    case "boolean": return { type: "checkbox" };
    case "enum": return { type: "select", options: row.allowed ?? [] };
    case "number": return { type: "number" };
    case "enum_list": return { type: "ordered_list", items: (row.allowed ?? []) as string[] };
    case "text_list": return { type: "text_list" };
    case "custom":
      return row.name === "palette" ? { type: "select", options: keep_current(row.allowed ?? []) } : { type: "text", suggestions: [] };
    case "text":
      return row.name === "default_engine" ? { type: "select", options: keep_current(engines) } : { type: "text", suggestions: [] };
    case "line": return { type: "text", suggestions: (row.allowed ?? []) as string[] };
    default: return { type: "read_only" };
  }
}

// A text control's raw text as the typed value. A number field's empty or broken text becomes NaN, which the check refuses.
export function value_of_text(control: Control, text: string): unknown {
  if (control.type === "number") return text.trim() === "" ? Number.NaN : Number(text);
  if (control.type === "text_list") return text.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  return text;
}

// The text a text control shows for a value.
export function text_of_value(control: Control, value: unknown): string {
  if (value === undefined) return "";
  if (control.type === "text_list") return Array.isArray(value) ? value.join("\n") : "";
  return String(value);
}

// The error line for a typed value, or undefined when the setting takes it.
export function problem_with(name: string, value: unknown): string | undefined {
  if (!is_setting_name(name)) return `unknown setting ${name}`;
  const spec = SETTING_SPECS[name];
  return spec.check(value) ? undefined : `${name}: expected ${spec.expectation}`;
}

// The tag text for each top layer. The record type fails the build when a layer is added without a label.
export const LAYER_LABEL: Record<SettingTag | "default", string> = {
  "settings.toml": "settings.toml",
  saved: "saved",
  temp: "temp",
  default: "default",
};

export type Field = {
  row: SettingListRow;
  control: Control;
  group: string;
  doc: string;
  // A value the reader typed that the background has not acknowledged. While it is set, a refresh leaves the field alone.
  draft?: { value: unknown };
  // An error from the check or the background, shown under the field.
  error?: string;
  // What `:set` would have toasted, for example a warning that the default engine names nothing.
  note?: string;
};

export type SessionDeps = {
  send: (message: ChangeSetting | ListSettings) => Promise<unknown>;
  engines: string[];
  // Called with the name of a field that changed, or undefined when any field may have.
  on_change: (name: string | undefined) => void;
};

export function create_settings_session(deps: SessionDeps) {
  const fields = new Map<string, Field>();
  // Bumped when a field's own edit starts and when its answer lands. A refresh that began before a bump is stale for that field.
  const touched = new Map<string, number>();
  const bump = (name: string) => touched.set(name, (touched.get(name) ?? 0) + 1);
  let refresh_running = false;
  let refresh_again = false;

  const new_field = (row: SettingListRow): Field => ({
    row,
    control: control_of(row, deps.engines),
    group: group_of(row.name),
    doc: SETTING_DOCS[row.name as keyof typeof SETTING_DOCS] ?? "",
  });

  function take_row(name: string, row: SettingListRow): void {
    const field = fields.get(name);
    if (field) Object.assign(field, new_field(row));
    else fields.set(name, new_field(row));
  }

  // A rejected send, for example while the background restarts, reads as a refusal.
  async function ask_for_list(): Promise<ListSettingsAnswer> {
    try {
      return (await deps.send({ type: "list_settings" })) as ListSettingsAnswer;
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async function refresh_once(): Promise<void> {
    const seen = new Map(touched);
    const answer = await ask_for_list();
    if (!answer.ok) return;
    for (const row of answer.settings) {
      const field = fields.get(row.name);
      if (field && (field.draft !== undefined || (touched.get(row.name) ?? 0) !== (seen.get(row.name) ?? 0))) continue;
      take_row(row.name, row);
    }
    deps.on_change(undefined);
  }

  // Many storage events arrive for one change, so overlapping calls share one more pass.
  async function refresh(): Promise<void> {
    if (refresh_running) {
      refresh_again = true;
      return;
    }
    refresh_running = true;
    try {
      do {
        refresh_again = false;
        await refresh_once();
      } while (refresh_again);
    } finally {
      refresh_running = false;
    }
  }

  // Marks the reader's typing: the check runs, nothing is sent.
  function draft(name: string, value: unknown): void {
    const field = fields.get(name);
    if (!field || field.control.type === "read_only") return;
    field.draft = { value };
    const problem = problem_with(name, value);
    if (problem === undefined) delete field.error;
    else field.error = problem;
    delete field.note;
    deps.on_change(name);
  }

  async function answered(name: string, field: Field, sequence: number, request: Omit<ChangeSetting, "type" | "name">, answer: ChangeSettingAnswer): Promise<void> {
    // A later edit of this field is in flight. Its answer decides.
    if (touched.get(name) !== sequence) return;
    bump(name);
    // The reader typed again while the save was in flight. That draft and its check result stay.
    const typed_since = field.draft !== undefined && (request.action === "reset" || JSON.stringify(field.draft.value) !== JSON.stringify(request.value));
    if (answer.ok) {
      Object.assign(field, new_field(answer.setting));
      field.note = answer.message;
      if (!typed_since) {
        delete field.draft;
        delete field.error;
      }
    } else if (!typed_since) {
      field.error = answer.message;
    }
    deps.on_change(name);
  }

  async function send_change(name: string, request: Omit<ChangeSetting, "type" | "name">): Promise<void> {
    const field = fields.get(name);
    if (!field) return;
    bump(name);
    const sequence = touched.get(name)!;
    let answer: ChangeSettingAnswer;
    try {
      answer = (await deps.send({ type: "change_setting", name, ...request })) as ChangeSettingAnswer;
    } catch (error) {
      answer = { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    await answered(name, field, sequence, request, answer);
  }

  // Saves at once, like `:set`, unless the check refuses the value.
  async function commit(name: string, value: unknown): Promise<void> {
    draft(name, value);
    if (fields.get(name)?.error !== undefined) return;
    await send_change(name, { action: "set", value });
  }

  // Drops the saved and the temp edit, so the file value shows. Also discards a draft.
  async function reset(name: string): Promise<void> {
    const field = fields.get(name);
    if (!field) return;
    delete field.draft;
    delete field.error;
    await send_change(name, { action: "reset" });
  }

  return {
    fields: () => [...fields.values()],
    field: (name: string) => fields.get(name),
    load: async (): Promise<boolean> => {
      const answer = await ask_for_list();
      if (!answer.ok) return false;
      fields.clear();
      for (const row of answer.settings) take_row(row.name, row);
      deps.on_change(undefined);
      return true;
    },
    refresh,
    draft,
    commit,
    reset,
  };
}

export type SettingsSession = ReturnType<typeof create_settings_session>;
