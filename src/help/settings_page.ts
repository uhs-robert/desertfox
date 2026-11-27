// Draws the settings page from a session and wires its controls. The session (`settings_model.ts`) holds the state, so this file only turns fields into nodes and events into session calls.

import { el } from "./dom.ts";
import { site_rule_effects } from "./site_rule_effect.ts";
import type { SiteRuleRow } from "../shared/match_pattern.ts";
import { can_reset, create_settings_session, GROUPS, is_changed, LAYER_LABEL, LAYER_TITLE, module_status_text, read_only_note, text_of_value, value_of_text } from "./settings_model.ts";
import { parse_font_family } from "../shared/theme/font_family.ts";
import { BROWSER_MODULE_STATUS_STORAGE_KEY } from "../shared/browser_module_protocol.ts";
import type { ModuleStatus } from "../shared/browser_module_protocol.ts";
import { touches_settings } from "../shared/storage_watch.ts";
import { FILE_WRITTEN_SETTINGS } from "../shared/settings_schema.ts";
import type { Control, Field, SessionDeps, SettingsSession } from "./settings_model.ts";

// One control: how to read the value it shows and how to put a value in without recreating it, which would drop focus and a half-typed edit.
type Widget = { node: HTMLElement; read: () => unknown; write: (value: unknown) => void };

type Hooks = { typing: (value: unknown) => void; commit: (value: unknown) => void };

function labelled(input: HTMLElement, name: string): HTMLElement {
  input.setAttribute("aria-label", name);
  return input;
}

function select_widget(name: string, options: unknown[], hooks: Hooks): Widget {
  const select = el("select", "desertfox-settings-input") as HTMLSelectElement;
  options.forEach((option, index) => {
    const entry = el("option", undefined, String(option)) as HTMLOptionElement;
    entry.value = String(index);
    select.append(entry);
  });
  const read = () => options[select.selectedIndex];
  select.addEventListener("change", () => hooks.commit(read()));
  return {
    node: labelled(select, name),
    read,
    write: (value) => {
      select.selectedIndex = options.findIndex((option) => option === value);
    },
  };
}

function checkbox_widget(name: string, hooks: Hooks): Widget {
  const box = el("input", "desertfox-settings-input") as HTMLInputElement;
  box.type = "checkbox";
  box.addEventListener("change", () => hooks.commit(box.checked));
  return { node: labelled(box, name), read: () => box.checked, write: (value) => { box.checked = value === true; } };
}

function text_widget(name: string, control: Control, hooks: Hooks): Widget {
  const multi = control.type === "text_list";
  const input = el(multi ? "textarea" : "input", "desertfox-settings-input") as HTMLInputElement | HTMLTextAreaElement;
  if (input instanceof HTMLTextAreaElement) input.rows = 3;
  else input.type = control.type === "number" ? "number" : "text";
  const suggestions = control.type === "text" ? control.suggestions : [];
  const list = el("datalist", undefined, ...suggestions.map((suggestion) => el("option", undefined, suggestion)));
  if (suggestions.length > 0) {
    list.id = `desertfox-settings-list-${name}`;
    input.setAttribute("list", list.id);
  }
  const read = () => value_of_text(control, input.value);
  // Typing only checks. The value is saved when the field is left or Enter is pressed.
  input.addEventListener("input", () => hooks.typing(read()));
  input.addEventListener("change", () => hooks.commit(read()));
  return { node: suggestions.length > 0 ? el("span", undefined, labelled(input, name), list) : labelled(input, name), read, write: (value) => { input.value = text_of_value(control, value); } };
}

// The Up and Down button of a list row. The caller sets `disabled` and the click handler.
function move_button(label: "Up" | "Down", item: string): HTMLButtonElement {
  const button = el("button", "desertfox-settings-move", label) as HTMLButtonElement;
  button.type = "button";
  name_move_button(button, label, item);
  return button;
}

function name_move_button(button: HTMLButtonElement, label: "Up" | "Down", item: string): void {
  button.setAttribute("aria-label", `${label === "Up" ? "Move up" : "Move down"} ${item}`);
}

function ordered_list_widget(name: string, items: string[], hooks: Hooks): Widget {
  const box = el("div", "desertfox-settings-order");
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", name);
  let order = [...items];
  let checked = new Set<string>();
  const read = () => order.filter((item) => checked.has(item));
  // `refocus` names the control that had focus before the redraw, so a move does not drop it.
  const draw = (refocus?: { item: string; label?: string }) => {
    let to_focus: HTMLElement | undefined;
    box.replaceChildren(
      ...order.map((item, index) => {
        const check = el("input", undefined) as HTMLInputElement;
        check.type = "checkbox";
        check.checked = checked.has(item);
        check.addEventListener("change", () => {
          if (check.checked) checked.add(item);
          else checked.delete(item);
          hooks.commit(read());
        });
        const move = (label: "Up" | "Down", by: number) => {
          const button = move_button(label, item);
          button.disabled = index + by < 0 || index + by >= order.length;
          button.addEventListener("click", () => {
            const other = order[index + by]!;
            order[index + by] = item;
            order[index] = other;
            draw({ item, label });
            hooks.commit(read());
          });
          return button;
        };
        const up = move("Up", -1);
        const down = move("Down", 1);
        if (refocus?.item === item) to_focus = [up, down].find((button) => button.textContent === refocus.label && !button.disabled) ?? check;
        return el("div", "desertfox-settings-order-row", el("label", undefined, check, ` ${item}`), up, down);
      }),
    );
    // A detached node ignores focus, so it runs after the rows are in the box.
    to_focus?.focus();
  };
  return {
    node: box,
    read,
    write: (value) => {
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      checked = new Set(chosen);
      order = [...chosen, ...items.filter((item) => !checked.has(item))];
      draw();
    },
  };
}

type Link = { label: string; url: string; group?: string };

// One row per link: label, address and group, with Up and Down buttons and one to drop it. A row with nothing typed is no link, so Add link never puts an empty table in the value.
function link_list_widget(name: string, hooks: Hooks): Widget {
  const box = el("div", "desertfox-settings-links");
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", name);
  const rows = el("div", undefined);
  const row_nodes: { node: HTMLElement; up: HTMLButtonElement; down: HTMLButtonElement; read: () => Link & { group: string } }[] = [];
  const read = (): Link[] =>
    row_nodes
      .map((row) => row.read())
      .filter((link) => link.label !== "" || link.url !== "" || link.group !== "")
      .map(({ group, ...link }) => (group === "" ? link : { ...link, group }));

  function add_row(link: Link = { label: "", url: "" }): void {
    const input = (label: string, placeholder: string, value: string) => {
      const field = el("input", "desertfox-settings-input") as HTMLInputElement;
      field.type = "text";
      field.placeholder = placeholder;
      field.value = value;
      field.spellcheck = false;
      field.setAttribute("aria-label", `${name} ${label}`);
      field.addEventListener("input", () => hooks.typing(read()));
      field.addEventListener("change", () => hooks.commit(read()));
      return field;
    };
    const label = input("label", "Label", link.label);
    const url = input("address", "https://example.com/", link.url);
    const group = input("group", "Group (optional)", link.group ?? "");
    const up = move_button("Up", link.label);
    const down = move_button("Down", link.label);
    const remove = el("button", "desertfox-settings-move", "Remove") as HTMLButtonElement;
    remove.type = "button";
    const node = el("div", "desertfox-settings-order-row", label, url, group, up, down, remove);
    // A row added empty or relabelled keeps names that match what is typed.
    const name_buttons = () => {
      name_move_button(up, "Up", label.value);
      name_move_button(down, "Down", label.value);
      remove.setAttribute("aria-label", `Remove the link ${label.value}`);
    };
    name_buttons();
    label.addEventListener("input", name_buttons);
    const row = { node, up, down, read: () => ({ label: label.value, url: url.value, group: group.value }) };
    const move = (button: HTMLButtonElement, by: number) =>
      button.addEventListener("click", () => {
        const at = row_nodes.indexOf(row);
        [row_nodes[at], row_nodes[at + by]] = [row_nodes[at + by]!, row_nodes[at]!];
        rows.replaceChildren(...row_nodes.map((entry) => entry.node));
        refresh_moves();
        // The redraw detaches the pressed button, so focus goes to the same direction on the moved row, or to the other one at the end of the list.
        (button.disabled ? (button === up ? down : up) : button).focus();
        hooks.commit(read());
      });
    move(up, -1);
    move(down, 1);
    remove.addEventListener("click", () => {
      row_nodes.splice(row_nodes.indexOf(row), 1);
      node.remove();
      refresh_moves();
      hooks.commit(read());
    });
    row_nodes.push(row);
    rows.append(node);
    refresh_moves();
  }

  function refresh_moves(): void {
    row_nodes.forEach((row, index) => {
      row.up.disabled = index === 0;
      row.down.disabled = index === row_nodes.length - 1;
    });
  }

  const add = el("button", "desertfox-settings-move", "Add link") as HTMLButtonElement;
  add.type = "button";
  add.addEventListener("click", () => {
    add_row();
    (rows.lastElementChild?.querySelector("input") as HTMLInputElement | null)?.focus();
  });
  box.append(rows, add);
  return {
    node: box,
    read,
    write: (value) => {
      row_nodes.length = 0;
      rows.replaceChildren();
      for (const link of Array.isArray(value) ? (value as Link[]) : []) add_row(link);
    },
  };
}

function widget_of(field: Field, hooks: Hooks): Widget | undefined {
  const name = field.row.name;
  switch (field.control.type) {
    case "checkbox": return checkbox_widget(name, hooks);
    case "select": return select_widget(name, field.control.options, hooks);
    case "ordered_list": return ordered_list_widget(name, field.control.items, hooks);
    case "link_list": return link_list_widget(name, hooks);
    case "number":
    case "text":
    case "text_list": return text_widget(name, field.control, hooks);
    case "read_only": return undefined;
  }
}

// The long description is kept for power users in a closed fold: it holds the input format, such as CSS selectors or the range of a number.
const more_of = (doc: string): HTMLElement => el("details", "desertfox-settings-more", el("summary", undefined, "More"), el("p", "desertfox-help-muted", doc));

// The Your site rules box: one table row per rule, with its site and its effect in words. The rules stay in the settings file, so the table has no controls except Reset. Rules in the saved layer (the popup's Disable on this site wrote them there before it wrote settings.toml) hide the file's rules, so they are marked and Reset clears them.
export function fill_site_rules(box: HTMLElement, field: Field, reset: () => void): void {
  const rules = Array.isArray(field.row.value) ? (field.row.value as SiteRuleRow[]) : [];
  const saved = field.row.top_layer === "saved" || field.row.top_layer === "temp";
  box.setAttribute("data-changed", String(is_changed(field.row)));
  const kept = saved ? [el("p", "desertfox-help-muted", "These rules are saved in the browser. Changes in your settings file do not apply until you reset them. "), saved_reset(reset)] : [];
  if (rules.length === 0) return box.replaceChildren(el("p", undefined, "You have no site rules of your own."), ...kept);
  const rows = rules.map((rule) => el("tr", undefined, el("td", undefined, el("code", undefined, rule.site), ...(saved ? [" ", el("span", "desertfox-help-badge", "Saved here")] : [])), el("td", undefined, ...effect_badges(rule))));
  box.replaceChildren(el("table", "desertfox-help-site-rules", el("tr", undefined, ...["Site", "Effect"].map((name) => el("th", undefined, name))), ...rows), ...kept);
}

function saved_reset(reset: () => void): HTMLElement {
  const button = el("button", "desertfox-settings-reset", "Reset") as HTMLButtonElement;
  button.type = "button";
  button.title = "Clear the saved site rules, so the ones in your settings file show.";
  button.addEventListener("click", reset);
  return button;
}

const effect_badges = (rule: SiteRuleRow): HTMLElement[] => site_rule_effects(rule).map((effect) => el("span", "desertfox-help-badge desertfox-site-rule-effect", effect));

export type Row = { node: HTMLElement; tag: HTMLElement; message: HTMLElement; reset: HTMLButtonElement; widget?: Widget; preview?: HTMLElement };

const SITE_RULES = "site_rules";

const PREVIEW_TEXT = "The quick brown fox jumps over the lazy dog. 0123456789 { } [ ] ( ) -> =>";

// A line set in the family as typed, so a name can be judged before it is saved. Text the parser refuses leaves the last line as it was. No family shows the browser's own default, or `monospace` for the mono setting, which is what the command line falls back to.
function show_preview(preview: HTMLElement, name: string, value: unknown): void {
  const family = parse_font_family(value);
  if (family !== undefined) preview.style.fontFamily = family || (name === "font_family_mono" ? "monospace" : "");
}

const MODULE_SETTING = "browser_module";

const RESET_TITLE_FILE_WRITTEN = "Remove the setting from settings.toml and drop your browser changes. A value set in a settings.d file stays: Reset drops only your browser changes, or with none it changes nothing and names the file. Change that value in the file.";
const RESET_TITLE_BROWSER_ONLY = "Drop your browser changes. This setting is kept in the browser, and settings.toml stays as it is. The setting goes back to its default, or to the value in your config files.";

function build_row(field: Field, session: SettingsSession, reload_key: string): Row {
  const name = field.row.name;
  const tag = el("span", "desertfox-help-badge");
  const message = el("div", "desertfox-settings-message");
  message.setAttribute("role", "status");
  const reset = el("button", "desertfox-settings-reset", "Reset") as HTMLButtonElement;
  reset.type = "button";
  // The row does not know which config file sets its value, so the file-written title covers settings.toml and settings.d alike, as `unset_in_settings_file` does.
  reset.title = FILE_WRITTEN_SETTINGS.has(name) ? RESET_TITLE_FILE_WRITTEN : RESET_TITLE_BROWSER_ONLY;
  reset.addEventListener("click", () => void session.reset(name).then(() => keep_focus_after_reset(node)));
  const widget = widget_of(field, { typing: (value) => session.draft(name, value), commit: (value) => void session.commit(name, value) });
  const doc = el("p", "desertfox-help-muted desertfox-settings-doc", field.summary);
  const head = el("div", "desertfox-settings-head", el("strong", undefined, field.label), tag);
  const has_preview = widget !== undefined && (name === "font_family" || name === "font_family_mono");
  const preview = has_preview ? el("div", "desertfox-settings-preview", PREVIEW_TEXT) : undefined;
  const body = widget
    ? el("div", "desertfox-settings-body", widget.node, reset)
    : el("div", "desertfox-settings-body", el("code", "desertfox-settings-value", JSON.stringify(field.row.value) ?? "unset"), el("span", "desertfox-help-muted", read_only_note(reload_key)));
  const code_name = el("small", "desertfox-help-muted", el("code", undefined, name));
  const node = el("div", "desertfox-settings-row", head, code_name, doc, more_of(field.doc), body, ...(preview ? [preview] : []), message);
  node.setAttribute("data-setting", name);
  return { node, tag, message, reset, ...(widget ? { widget } : {}), ...(preview ? { preview } : {}) };
}

// With the changed-only filter on, a reset row turns "default" and CSS hides it, so its button would drop the focus to the page. The focus goes to the next changed row, else to the filter box.
function keep_focus_after_reset(node: HTMLElement): void {
  if (node.getAttribute("data-changed") !== "false" || !node.closest(".desertfox-only-changed")) return;
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.desertfox-settings-row[data-changed="true"]'));
  const next = rows.find((row) => node.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) ?? rows.at(-1);
  const target = next?.querySelector<HTMLElement>("input, select, textarea, button:not(:disabled)") ?? document.querySelector<HTMLElement>(".desertfox-only-changed-toggle");
  target?.focus();
}

export function update_row(row: Row, field: Field): void {
  row.tag.textContent = LAYER_LABEL[field.row.top_layer];
  row.tag.title = LAYER_TITLE[field.row.top_layer];
  // The changed-only filter reads this attribute in CSS (home.html), so a row that becomes changed stays shown.
  row.node.setAttribute("data-changed", String(is_changed(field.row)));
  row.reset.disabled = !can_reset(field.row) && field.draft === undefined;
  row.message.textContent = field.error ?? field.note ?? "";
  row.message.classList.toggle("desertfox-settings-error", field.error !== undefined);
  if (!row.widget) return;
  if (row.preview) show_preview(row.preview, field.row.name, field.draft ? field.draft.value : field.row.value);
  if (row.widget.node.getAttribute("aria-invalid") !== String(field.error !== undefined)) row.widget.node.setAttribute("aria-invalid", String(field.error !== undefined));
  // The reader's own draft stays as typed.
  if (field.draft !== undefined) return;
  if (JSON.stringify(row.widget.read()) !== JSON.stringify(field.row.value)) row.widget.write(field.row.value);
}

type StorageChangedEvents = { addListener: (listener: (changes: Record<string, unknown>, area: string) => void) => void; removeListener: (listener: (changes: Record<string, unknown>, area: string) => void) => void };

// Loads the settings into `container` and keeps them current: a change in another tab refreshes the rows the reader is not editing. The returned function stops the listening. The router calls it before it rebuilds the body.
export function mount_settings(container: HTMLElement, send: SessionDeps["send"], engines: string[], storage_changed: StorageChangedEvents, reload_key: string, resolve_keys: SessionDeps["resolve_keys"], read_module_status?: () => Promise<ModuleStatus | undefined>): () => void {
  const rows = new Map<string, Row>();
  const show_site_rules = (fields: Field[], session: SettingsSession) => {
    const box = container.querySelector<HTMLElement>(`[data-setting="${SITE_RULES}"]`);
    const field = fields.find((candidate) => candidate.row.name === SITE_RULES);
    if (box && field) fill_site_rules(box, field, () => void session.reset(SITE_RULES));
  };
  // The headings and the group boxes come from the render, so a section link reaches a heading before the settings load.
  const build = (session: SettingsSession) => {
    const fields = session.fields();
    show_site_rules(fields, session);
    for (const group of GROUPS) {
      const box = container.querySelector(`[data-group="${group.title}"]`);
      box?.replaceChildren(
        ...fields.filter((field) => field.group === group.title && field.row.name !== SITE_RULES).map((field) => {
          const row = build_row(field, session, reload_key);
          rows.set(field.row.name, row);
          row.widget?.write(field.row.value);
          update_row(row, field);
          if (field.row.name === MODULE_SETTING && module_line) row.node.append(module_line);
          return row.node;
        }),
      );
    }
  };
  // The browser module row also shows what became of the module's hello. It sits in the session area, which the settings listener ignores.
  const module_line = read_module_status ? el("div", "desertfox-help-muted desertfox-settings-module-status") : undefined;
  module_line?.setAttribute("role", "status");
  const show_module_status = () => void read_module_status?.().then((status) => void (module_line && (module_line.textContent = module_status_text(status))));
  const session: SettingsSession = create_settings_session({
    send,
    engines,
    resolve_keys,
    on_change: (name) => {
      if (rows.size === 0) return build(session);
      if (name === undefined || name === SITE_RULES) show_site_rules(session.fields(), session);
      for (const field of session.fields()) {
        const row = rows.get(field.row.name);
        if (row && (name === undefined || name === field.row.name)) update_row(row, field);
      }
    },
  });
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (touches_settings(changes, area)) void session.refresh();
    if (area === "session" && BROWSER_MODULE_STATUS_STORAGE_KEY in changes) show_module_status();
    if (touches_settings(changes, area)) show_module_status();
  };
  let stopped = false;
  const stop = () => {
    stopped = true;
    storage_changed.removeListener(listener);
  };
  void session.load().then((loaded) => {
    if (stopped) return;
    if (loaded) {
      storage_changed.addListener(listener);
      show_module_status();
    }
    else container.prepend(el("p", "desertfox-settings-error", "The settings could not be loaded."));
  });
  return stop;
}
