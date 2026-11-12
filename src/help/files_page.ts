// Draws the files editor of the settings page from a files session (`files_model.ts`): the stored files, a text box for the open one, every build problem, and for a snippet the consent screen of the import review.

import { el } from "./render.ts";
import { create_files_session } from "./files_model.ts";
import type { FilesDeps, FilesSession } from "./files_model.ts";
import { button, snippet_card } from "./transfer_page.ts";
import { SNIPPET_WARNING } from "./transfer_model.ts";

function consent_view(session: FilesSession): HTMLElement[] {
  const { consent } = session.state;
  if (!consent) return [];
  const accepted = new Set(session.state.accepted ? [consent.path] : []);
  return [el("p", "desertfox-transfer-warning", SNIPPET_WARNING), snippet_card(consent, { accepted }, { accept: (_path, on) => session.accept(on) })];
}

function editor_view(session: FilesSession): HTMLElement[] {
  const { open, busy, consent, accepted } = session.state;
  if (!open) return [];
  const area = el("textarea", "desertfox-files-text") as HTMLTextAreaElement;
  area.value = open.text;
  area.rows = 18;
  area.spellcheck = false;
  area.setAttribute("aria-label", `Text of ${open.path}`);
  area.setAttribute("data-files", "text");
  area.addEventListener("input", () => session.edit(area.value));
  // A snippet saves only after its consent box is ticked, with the code the box shows.
  const blocked = busy || (consent !== undefined && !accepted);
  const save = button(consent ? "Accept and save" : "Save", () => void session.save(), blocked);
  save.setAttribute("data-files", "save");
  return [el("h3", undefined, open.is_new ? `New file ${open.path}` : open.path), area, el("div", "desertfox-settings-body", save, button("Close", () => session.close()))];
}

function list_view(session: FilesSession): HTMLElement[] {
  const rows = Object.keys(session.state.files).sort().map((path) => {
    const open = button("Open", () => session.open(path));
    open.setAttribute("aria-label", `Open ${path}`);
    const remove = button("Delete", () => void session.remove(path), session.state.busy);
    remove.setAttribute("aria-label", `Delete ${path}`);
    return el("div", "desertfox-transfer-installed", el("code", undefined, path), open, remove);
  });
  return rows.length > 0 ? rows : [el("p", "desertfox-help-muted", "No config file is stored. Make one below.")];
}

export function mount_files(container: HTMLElement, send: FilesDeps["send"]): FilesSession {
  const message = el("div", "desertfox-settings-message");
  message.setAttribute("role", "status");
  const list_box = el("div", undefined);
  const problems_box = el("div", undefined);
  const editor_box = el("div", undefined);
  const new_error = el("div", "desertfox-settings-error");
  const name = el("input", undefined) as HTMLInputElement;
  name.type = "text";
  name.placeholder = "keymap.toml, search_engines.toml, snippets/my.js";
  name.setAttribute("aria-label", "Path of a new config file");
  name.setAttribute("data-files", "new-path");
  const make = button("New file", () => {
    new_error.textContent = session.start_new(name.value.trim()) ?? "";
    if (new_error.textContent === "") name.value = "";
  });
  let editor_shown = "";
  const draw = () => {
    const { state } = session;
    message.textContent = state.message?.text ?? "";
    message.classList.toggle("desertfox-settings-error", state.message?.ok === false);
    list_box.replaceChildren(...list_view(session));
    problems_box.replaceChildren(...state.problems.map((problem) => el("div", "desertfox-settings-error", problem)));
    // The text box keeps focus and caret while the user types, so the editor redraws only when what it shows changes, not on each keystroke.
    const shown = JSON.stringify([state.open?.path, state.open?.is_new, state.consent?.code, state.accepted]);
    if (shown !== editor_shown) {
      editor_shown = shown;
      editor_box.replaceChildren(...editor_view(session), ...consent_view(session));
    }
    editor_box.querySelector<HTMLButtonElement>("[data-files=save]")?.toggleAttribute("disabled", state.busy || (state.consent !== undefined && !state.accepted));
  };
  const session = create_files_session({ send, on_change: draw });
  container.replaceChildren(list_box, el("div", "desertfox-settings-body", name, make), new_error, message, problems_box, editor_box);
  draw();
  void session.load();
  return session;
}
