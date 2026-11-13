// Draws a name-to-value section of the settings page (Aliases, Quickmarks) from a pairs session (`pairs_model.ts`).

import { el } from "./render.ts";
import { button } from "./transfer_page.ts";
import { can_save, create_pairs_session, form_problems } from "./pairs_model.ts";
import type { PairsDeps, PairsForm, PairsKind, PairsSession } from "./pairs_model.ts";

type StorageChangedEvents = { addListener: (listener: (changes: Record<string, unknown>, area: string) => void) => void; removeListener: (listener: (changes: Record<string, unknown>, area: string) => void) => void };

// Draws the section into `container`. `follows` says which storage changes touch the rows, so the list follows a change from another tab or from `M`. The returned function stops the listener.
export function mount_pairs(container: HTMLElement, kind: PairsKind, deps: Omit<PairsDeps, "on_change">, storage_changed: StorageChangedEvents, follows: (changes: Record<string, unknown>, area: string) => boolean): () => void {
  let session: PairsSession;
  let stopped = false;
  const hints_id = `desertfox-${kind.noun}s-hints`;

  const inputs = new Map<keyof PairsForm, HTMLInputElement>();
  const fields: { name: keyof PairsForm; label: string; placeholder: string }[] = [
    { name: "key", label: kind.key_label, placeholder: kind.key_placeholder },
    { name: "value", label: kind.value_label, placeholder: kind.value_placeholder },
  ];
  const field_nodes = fields.map((field) => {
    const input = el("input", "desertfox-settings-input") as HTMLInputElement;
    input.type = "text";
    input.placeholder = field.placeholder;
    input.setAttribute("aria-label", `${kind.noun} ${field.label.toLowerCase()}`);
    input.setAttribute("autocomplete", "off");
    input.spellcheck = false;
    input.addEventListener("input", () => session.set_field(field.name, input.value));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void session.save();
    });
    inputs.set(field.name, input);
    return el("label", "desertfox-engines-field", el("span", "desertfox-help-muted", field.label), input);
  });
  const hints = el("div", "desertfox-settings-error");
  hints.setAttribute("role", "status");
  hints.id = hints_id;
  const message = el("div", undefined);
  message.setAttribute("role", "status");
  const save = button(`Save ${kind.noun}`, () => void session.save());
  const cancel = button("Clear", () => session.clear_form());
  const status = el("p", "desertfox-settings-error");
  const list = el("div", "desertfox-engines-list");

  function draw(): void {
    if (stopped) return;
    const { state } = session;
    status.textContent = state.error ?? "";
    for (const [name, input] of inputs) {
      if (input.value !== state.form[name]) input.value = state.form[name];
    }
    // The key is fixed while a row is edited: a save replaces that row.
    inputs.get("key")!.readOnly = state.editing !== undefined;
    const problems = form_problems(kind, state.form);
    hints.replaceChildren(...problems.map((problem) => el("div", undefined, problem)));
    for (const input of inputs.values()) {
      input.setAttribute("aria-invalid", String(problems.length > 0));
      input.setAttribute("aria-describedby", hints_id);
    }
    save.disabled = !can_save(kind, state);
    message.textContent = state.message?.text ?? "";
    message.className = state.message?.ok === false ? "desertfox-settings-error" : "desertfox-help-muted";
    if (state.rows.length === 0) {
      list.replaceChildren(el("p", "desertfox-help-muted", state.loaded ? kind.empty_text : "Loading..."));
      return;
    }
    const rows = state.rows.map((row) => {
      const edit = button(row.removable ? "Edit" : "Replace", () => {
        session.edit(row);
        inputs.get("value")!.focus();
      });
      edit.setAttribute("aria-label", `${row.removable ? "Edit" : "Replace"} the ${kind.noun} ${row.key}`);
      const remove = button("Remove", () => void session.remove(row.key));
      remove.setAttribute("aria-label", `Remove the ${kind.noun} ${row.key}`);
      return el(
        "tr",
        undefined,
        el("td", undefined, el("code", undefined, row.key)),
        el("td", undefined, el("code", undefined, row.value), ...(row.left_out ? [el("div", "desertfox-settings-error", `Not used: ${row.left_out}`)] : []), ...(row.note ? [el("div", "desertfox-help-muted", row.note)] : [])),
        el("td", undefined, edit, ...(row.removable ? [" ", remove] : [])),
      );
    });
    list.replaceChildren(el("table", "desertfox-keys-table", ...rows));
  }

  session = create_pairs_session(kind, { ...deps, on_change: draw });
  container.replaceChildren(el("div", "desertfox-engines-form", ...field_nodes, el("div", "desertfox-keys-editor-line", save, cancel)), hints, message, status, list);
  draw();
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (follows(changes, area)) void session.refresh();
  };
  storage_changed.addListener(listener);
  void session.refresh();
  return () => {
    stopped = true;
    storage_changed.removeListener(listener);
  };
}
