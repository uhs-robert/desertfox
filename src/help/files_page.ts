// Draws the files editor of the settings page from a files session (`files_model.ts`): the stored files, a text box for the open one, every build problem, and for a snippet the consent screen of the import review.

import { el } from "./render.ts";
import { NO_USER_CSS_HOLD, USER_CSS_PAUSED_NOTE, type UserCssHold } from "./user_css_gate.ts";
import type { FilesSession } from "./files_model.ts";
import { button, snippet_card } from "./transfer_page.ts";
import { SNIPPET_GLOSS, SNIPPET_WARNING } from "./transfer_model.ts";

function consent_view(session: FilesSession): HTMLElement[] {
  const { consent } = session.state;
  if (!consent) return [];
  const accepted = new Set(session.state.accepted ? [consent.path] : []);
  return [el("p", "desertfox-help-muted", USER_CSS_PAUSED_NOTE), el("p", undefined, SNIPPET_GLOSS), el("p", "desertfox-transfer-warning", SNIPPET_WARNING), snippet_card(consent, { accepted }, { accept: (_path, on) => session.accept(on) })];
}

// The text box, heading and buttons of the open file. Built once per open file, so typing and consent changes never replace the textarea and its focus.
function editor_view(session: FilesSession): { nodes: HTMLElement[]; heading: HTMLElement; save: HTMLButtonElement } | undefined {
  const { open } = session.state;
  if (!open) return undefined;
  const area = el("textarea", "desertfox-files-text") as HTMLTextAreaElement;
  area.value = open.text;
  area.rows = 18;
  area.spellcheck = false;
  area.setAttribute("aria-label", `Text of ${open.path}`);
  area.setAttribute("data-files", "text");
  area.addEventListener("input", () => session.edit(area.value));
  const save = button("Save", () => void session.save());
  save.setAttribute("data-files", "save");
  const heading = el("h3", undefined);
  return { nodes: [heading, area, el("div", "desertfox-settings-body", save, button("Close", () => session.close()))], heading, save };
}

function list_view(session: FilesSession): HTMLElement[] {
  const rows = Object.keys(session.state.files).sort().map((path) => {
    const open = button("Open", () => session.open(path));
    open.setAttribute("aria-label", `Open ${path}`);
    const remove = button("Delete", () => void session.remove(path), session.state.busy);
    remove.setAttribute("aria-label", `Delete ${path}`);
    return el("div", "desertfox-transfer-installed desertfox-files-row", el("code", undefined, path), open, remove);
  });
  return rows.length > 0 ? rows : [el("p", "desertfox-help-muted", "You have no settings files stored. Make one below.")];
}

// Draws `session` into `container`. The session is the caller's and outlives the mount, so an unsaved draft survives a rebuild of the page.
export function mount_files(container: HTMLElement, session: FilesSession, user_css_hold: UserCssHold = NO_USER_CSS_HOLD): FilesSession {
  const message = el("div", "desertfox-settings-message");
  message.setAttribute("role", "status");
  const list_box = el("div", undefined);
  const problems_box = el("div", undefined);
  const editor_box = el("div", undefined);
  const consent_box = el("div", undefined);
  const new_error = el("div", "desertfox-settings-error");
  const name = el("input", undefined) as HTMLInputElement;
  name.type = "text";
  name.placeholder = "keymap.toml, search_engines.toml, snippets/my.js";
  name.setAttribute("aria-label", "Path of a new settings file");
  name.setAttribute("data-files", "new-path");
  const make = button("New file", () => {
    new_error.textContent = session.start_new(name.value.trim()) ?? "";
    if (new_error.textContent === "") name.value = "";
  });
  let editor: ReturnType<typeof editor_view>;
  let editing_path: string | undefined;
  let consent_shown = "";
  const draw = () => {
    const { state } = session;
    message.textContent = state.message?.text ?? "";
    message.classList.toggle("desertfox-settings-error", state.message?.ok === false);
    list_box.replaceChildren(...list_view(session));
    problems_box.replaceChildren(...state.problems.map((problem) => el("div", "desertfox-settings-error", problem)));
    // The editor is replaced only when another file opens. A change of text, consent or save state updates the parts in place.
    if (state.open?.path !== editing_path || (state.open !== undefined && editor === undefined)) {
      editing_path = state.open?.path;
      editor = editor_view(session);
      editor_box.replaceChildren(...(editor?.nodes ?? []));
    }
    if (editor && state.open) {
      editor.heading.textContent = state.open.is_new ? `New file ${state.open.path}` : state.open.path;
      const area = editor.nodes[1] as HTMLTextAreaElement;
      if (area.value !== state.open.text) area.value = state.open.text;
      editor.save.textContent = state.consent ? "Accept and save" : "Save";
      // A snippet saves only after its consent box is ticked, with the code the box shows.
      editor.save.disabled = state.busy || (state.consent !== undefined && !state.accepted);
    }
    // Ticking the box redraws the card, so focus returns to the new box.
    const shown = JSON.stringify([state.consent?.code, state.accepted]);
    if (shown !== consent_shown) {
      consent_shown = shown;
      const had_focus = document.activeElement?.hasAttribute("data-snippet") ?? false;
      consent_box.replaceChildren(...consent_view(session));
      if (had_focus) consent_box.querySelector<HTMLElement>("[data-snippet]")?.focus();
    }
  };
  container.replaceChildren(list_box, el("div", "desertfox-settings-body", name, make), new_error, message, problems_box, editor_box, consent_box);
  session.attach(draw, user_css_hold);
  draw();
  void session.load();
  return session;
}
