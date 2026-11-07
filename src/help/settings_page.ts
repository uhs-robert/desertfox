// Draws the settings page from a session and wires its controls. The session (`settings_model.ts`) holds the state, so this file only turns fields into nodes and events into session calls.

import { el } from "./render.ts";
import { create_settings_session, GROUPS, READ_ONLY_NOTE, text_of_value, touches_settings, value_of_text } from "./settings_model.ts";
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
  const draw = () => {
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
            draw();
            hooks.commit(read());
          });
          return button;
        };
        return el("div", "desertfox-settings-order-row", el("label", undefined, check, ` ${item}`), move("Up", -1), move("Down", 1));
      }),
    );
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

function widget_of(field: Field, hooks: Hooks): Widget | undefined {
  const name = field.row.name;
  switch (field.control.type) {
    case "checkbox": return checkbox_widget(name, hooks);
    case "select": return select_widget(name, field.control.options, hooks);
    case "ordered_list": return ordered_list_widget(name, field.control.items, hooks);
    case "number":
    case "text":
    case "text_list": return text_widget(name, field.control, hooks);
    case "read_only": return undefined;
  }
}

type Row = { node: HTMLElement; tag: HTMLElement; message: HTMLElement; reset: HTMLButtonElement; widget?: Widget };

function build_row(field: Field, session: SettingsSession): Row {
  const name = field.row.name;
  const tag = el("span", "desertfox-help-badge");
  const message = el("div", "desertfox-settings-message");
  message.setAttribute("role", "status");
  const reset = el("button", "desertfox-settings-reset", "Reset") as HTMLButtonElement;
  reset.type = "button";
  reset.title = "Drop the saved and temp edit, so the config file value applies";
  reset.addEventListener("click", () => void session.reset(name));
  const widget = widget_of(field, { typing: (value) => session.draft(name, value), commit: (value) => void session.commit(name, value) });
  const doc = el("p", "desertfox-help-muted desertfox-settings-doc", field.doc);
  const head = el("div", "desertfox-settings-head", el("code", undefined, name), tag);
  const body = widget
    ? el("div", "desertfox-settings-body", widget.node, reset)
    : el("div", "desertfox-settings-body", el("code", "desertfox-settings-value", JSON.stringify(field.row.value) ?? "unset"), el("span", "desertfox-help-muted", READ_ONLY_NOTE));
  const node = el("div", "desertfox-settings-row", head, doc, body, message);
  node.setAttribute("data-setting", name);
  return { node, tag, message, reset, ...(widget ? { widget } : {}) };
}

function update_row(row: Row, field: Field): void {
  row.tag.textContent = field.row.top_layer;
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

// Loads the settings into `container` and keeps them current: a change in another tab refreshes the rows the reader is not editing. Stops listening once the container leaves the page, because the router rebuilds the body on each route.
export async function mount_settings(container: HTMLElement, send: SessionDeps["send"], engines: string[], storage_changed: StorageChangedEvents): Promise<void> {
  const rows = new Map<string, Row>();
  // The headings and the group boxes come from the render, so a section link reaches a heading before the settings load.
  const build = (session: SettingsSession) => {
    const fields = session.fields();
    for (const group of GROUPS) {
      const box = container.querySelector(`[data-group="${group.title}"]`);
      box?.replaceChildren(
        ...fields.filter((field) => field.group === group.title).map((field) => {
          const row = build_row(field, session);
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
    if (!container.isConnected) storage_changed.removeListener(listener);
    else if (touches_settings(changes, area)) void session.refresh();
  };
  if (!(await session.load())) {
    container.prepend(el("p", "desertfox-settings-error", "The settings could not be loaded."));
    return;
  }
  storage_changed.addListener(listener);
}
