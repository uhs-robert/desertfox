// Draws the Search engines section of the settings page from an engines session (`engines_model.ts`).

import { el } from "./render.ts";
import { button } from "./transfer_page.ts";
import { can_save, create_engines_session, form_problems } from "./engines_model.ts";
import type { EnginesDeps, EnginesSession, EngineForm } from "./engines_model.ts";
import { touches_settings } from "../shared/storage_watch.ts";

type StorageChangedEvents = { addListener: (listener: (changes: Record<string, unknown>, area: string) => void) => void; removeListener: (listener: (changes: Record<string, unknown>, area: string) => void) => void };

const FIELDS: { name: keyof EngineForm; label: string; placeholder: string }[] = [
  { name: "name", label: "Name", placeholder: "wiki" },
  { name: "url", label: "Address", placeholder: "https://en.wikipedia.org/w/index.php?search={query}" },
  { name: "keyword", label: "Keyword (optional)", placeholder: "w" },
  { name: "letter", label: "Key letter (optional)", placeholder: "w" },
];

// Draws the section into `container`. The returned function stops the storage listener.
export function mount_engines(container: HTMLElement, deps: Omit<EnginesDeps, "on_change">, storage_changed: StorageChangedEvents): () => void {
  let session: EnginesSession;
  let stopped = false;

  const inputs = new Map<keyof EngineForm, HTMLInputElement>();
  const field_nodes = FIELDS.map((field) => {
    const input = el("input", "desertfox-settings-input") as HTMLInputElement;
    input.type = "text";
    input.placeholder = field.placeholder;
    input.setAttribute("aria-label", field.label);
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
  hints.id = "desertfox-engines-hints";
  const message = el("div", undefined);
  message.setAttribute("role", "status");
  const save = button("Save engine", () => void session.save());
  const cancel = button("Clear", () => session.clear_form());
  const starter = button("Add the starter engines", () => void session.add_starter());
  const status = el("p", "desertfox-settings-error");
  const list = el("div", "desertfox-engines-list");

  function draw(): void {
    if (stopped) return;
    const { state } = session;
    status.textContent = state.error ?? "";
    for (const [name, input] of inputs) {
      if (input.value !== state.form[name]) input.value = state.form[name];
    }
    // The name is fixed while a row is edited: a save replaces that engine.
    inputs.get("name")!.readOnly = state.editing !== undefined;
    const problems = form_problems(state.form);
    hints.replaceChildren(...problems.map((problem) => el("div", undefined, problem)));
    for (const input of inputs.values()) {
      input.setAttribute("aria-invalid", String(problems.length > 0));
      input.setAttribute("aria-describedby", "desertfox-engines-hints");
    }
    save.disabled = !can_save(state);
    starter.disabled = state.busy;
    message.textContent = state.message?.text ?? "";
    message.className = state.message?.ok === false ? "desertfox-settings-error" : "desertfox-help-muted";
    if (state.rows.length === 0) {
      list.replaceChildren(el("p", "desertfox-help-muted", state.loaded ? "No engine was added in the browser yet." : "Loading..."));
      return;
    }
    const rows = state.rows.map((row) => {
      const edit = button("Edit", () => {
        session.edit(row);
        inputs.get("url")!.focus();
      });
      edit.setAttribute("aria-label", `Edit the engine ${row.name}`);
      const remove = button("Remove", () => void session.remove(row.name));
      remove.setAttribute("aria-label", `Remove the engine ${row.name}`);
      const details = [row.label !== row.name ? row.label : "", row.keyword ? `keyword ${row.keyword}` : "", row.letter ? `key s${row.letter}` : "", row.children > 0 ? `${row.children} child engine(s)` : ""].filter((text) => text !== "");
      return el(
        "tr",
        undefined,
        el("td", undefined, el("code", undefined, row.name)),
        el("td", undefined, row.url === "" ? el("span", "desertfox-help-muted", "(group)") : el("code", undefined, row.url), ...(details.length > 0 ? [el("div", "desertfox-help-muted", details.join(", "))] : []), ...(row.left_out ? [el("div", "desertfox-settings-error", `Left out: ${row.left_out}`)] : [])),
        el("td", undefined, row.url === "" ? "" : edit, " ", remove),
      );
    });
    list.replaceChildren(el("table", "desertfox-keys-table", ...rows));
  }

  session = create_engines_session({ ...deps, on_change: draw });
  container.replaceChildren(
    el("div", "desertfox-engines-form", ...field_nodes, el("div", "desertfox-keys-editor-line", save, cancel)),
    hints,
    message,
    status,
    el("p", undefined, "The starter set adds the sample engines of examples/engines.toml, except those whose name your config files or these engines already use."),
    el("div", "desertfox-keys-editor-line", starter),
    list,
  );
  draw();
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (touches_settings(changes, area)) void session.refresh();
  };
  storage_changed.addListener(listener);
  void session.refresh();
  return () => {
    stopped = true;
    storage_changed.removeListener(listener);
  };
}
