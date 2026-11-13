// Draws the settings page from a session and wires its controls. The session (`settings_model.ts`) holds the state, so this file only turns fields into nodes and events into session calls.

import { el } from "./render.ts";
import { create_settings_session, GROUPS, is_changed, LAYER_LABEL, LAYER_TITLE, read_only_note, text_of_value, value_of_text } from "./settings_model.ts";
import { touches_settings } from "../shared/storage_watch.ts";
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
        const move = (label: string, by: number) => {
          const button = el("button", "desertfox-settings-move", label) as HTMLButtonElement;
          button.type = "button";
          button.setAttribute("aria-label", `${label === "Up" ? "Move up" : "Move down"} ${item}`);
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

// One row per link: label, address and group, with a button to drop it. A row with nothing typed is no link, so Add link never puts an empty table in the value.
function link_list_widget(name: string, hooks: Hooks): Widget {
  const box = el("div", "desertfox-settings-links");
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", name);
  const rows = el("div", undefined);
  const row_nodes: { node: HTMLElement; read: () => Link & { group: string } }[] = [];
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
    const remove = el("button", "desertfox-settings-move", "Remove") as HTMLButtonElement;
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove the link ${link.label}`);
    const node = el("div", "desertfox-settings-order-row", label, url, group, remove);
    const row = { node, read: () => ({ label: label.value, url: url.value, group: group.value }) };
    remove.addEventListener("click", () => {
      row_nodes.splice(row_nodes.indexOf(row), 1);
      node.remove();
      hooks.commit(read());
    });
    row_nodes.push(row);
    rows.append(node);
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

export type Row = { node: HTMLElement; tag: HTMLElement; message: HTMLElement; reset: HTMLButtonElement; widget?: Widget };

function build_row(field: Field, session: SettingsSession, reload_key: string): Row {
  const name = field.row.name;
  const tag = el("span", "desertfox-help-badge");
  const message = el("div", "desertfox-settings-message");
  message.setAttribute("role", "status");
  const reset = el("button", "desertfox-settings-reset", "Reset") as HTMLButtonElement;
  reset.type = "button";
  reset.title = "Undo your change. The setting goes back to its default, or to the value in your settings file.";
  reset.addEventListener("click", () => void session.reset(name).then(() => keep_focus_after_reset(node)));
  const widget = widget_of(field, { typing: (value) => session.draft(name, value), commit: (value) => void session.commit(name, value) });
  const doc = el("p", "desertfox-help-muted desertfox-settings-doc", field.summary);
  const head = el("div", "desertfox-settings-head", el("strong", undefined, field.label), tag);
  const body = widget
    ? el("div", "desertfox-settings-body", widget.node, reset)
    : el("div", "desertfox-settings-body", el("code", "desertfox-settings-value", JSON.stringify(field.row.value) ?? "unset"), el("span", "desertfox-help-muted", read_only_note(reload_key)));
  const code_name = el("small", "desertfox-help-muted", el("code", undefined, name));
  const node = el("div", "desertfox-settings-row", head, code_name, doc, more_of(field.doc), body, message);
  node.setAttribute("data-setting", name);
  return { node, tag, message, reset, ...(widget ? { widget } : {}) };
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
  const edited = field.row.top_layer === "saved" || field.row.top_layer === "temp";
  row.reset.disabled = !edited && field.draft === undefined;
  row.message.textContent = field.error ?? field.note ?? "";
  row.message.classList.toggle("desertfox-settings-error", field.error !== undefined);
  if (!row.widget) return;
  if (row.widget.node.getAttribute("aria-invalid") !== String(field.error !== undefined)) row.widget.node.setAttribute("aria-invalid", String(field.error !== undefined));
  // The reader's own draft stays as typed.
  if (field.draft !== undefined) return;
  if (JSON.stringify(row.widget.read()) !== JSON.stringify(field.row.value)) row.widget.write(field.row.value);
}

type StorageChangedEvents = { addListener: (listener: (changes: Record<string, unknown>, area: string) => void) => void; removeListener: (listener: (changes: Record<string, unknown>, area: string) => void) => void };

// Loads the settings into `container` and keeps them current: a change in another tab refreshes the rows the reader is not editing. The returned function stops the listening. The router calls it before it rebuilds the body.
export function mount_settings(container: HTMLElement, send: SessionDeps["send"], engines: string[], storage_changed: StorageChangedEvents, reload_key = "the reload key"): () => void {
  const rows = new Map<string, Row>();
  // The headings and the group boxes come from the render, so a section link reaches a heading before the settings load.
  const build = (session: SettingsSession) => {
    const fields = session.fields();
    for (const group of GROUPS) {
      const box = container.querySelector(`[data-group="${group.title}"]`);
      box?.replaceChildren(
        ...fields.filter((field) => field.group === group.title).map((field) => {
          const row = build_row(field, session, reload_key);
          rows.set(field.row.name, row);
          row.widget?.write(field.row.value);
          update_row(row, field);
          return row.node;
        }),
      );
    }
  };
  const session: SettingsSession = create_settings_session({
    send,
    engines,
    on_change: (name) => {
      if (rows.size === 0) return build(session);
      for (const field of session.fields()) {
        const row = rows.get(field.row.name);
        if (row && (name === undefined || name === field.row.name)) update_row(row, field);
      }
    },
  });
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (touches_settings(changes, area)) void session.refresh();
  };
  let stopped = false;
  const stop = () => {
    stopped = true;
    storage_changed.removeListener(listener);
  };
  void session.load().then((loaded) => {
    if (stopped) return;
    if (loaded) storage_changed.addListener(listener);
    else container.prepend(el("p", "desertfox-settings-error", "The settings could not be loaded."));
  });
  return stop;
}
