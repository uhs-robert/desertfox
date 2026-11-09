// Draws the export and import section of the settings page from a transfer session (`transfer_model.ts`).
// The consent screen shows each snippet's full code, `matches` and `requires`. A snippet is stored only when its box is ticked and Import is pressed.

import { el } from "./render.ts";
import { create_transfer_session, can_commit, read_folder_files, read_zip_file, SNIPPET_WARNING } from "./transfer_model.ts";
import type { ExportFile, PickedFile, Review, TransferSession } from "./transfer_model.ts";
import type { InstalledSnippet, SnippetPreview } from "../shared/messages.ts";
import type { TransferDeps } from "./transfer_model.ts";

function button(label: string, on_click: () => void, disabled = false): HTMLButtonElement {
  const node = el("button", "desertfox-settings-install", label) as HTMLButtonElement;
  node.type = "button";
  node.disabled = disabled;
  node.addEventListener("click", on_click);
  return node;
}

function download(file: ExportFile): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: "application/zip" }));
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(link.href);
}

// A hidden input behind a button. The pick resets the input, so choosing the same file twice still fires.
function picker(label: string, name: string, on_pick: (files: PickedFile[]) => void, options: { folder?: boolean; accept?: string }): HTMLElement {
  const input = el("input", "desertfox-transfer-input") as HTMLInputElement;
  input.type = "file";
  input.setAttribute("aria-label", name);
  input.setAttribute("data-transfer", name);
  if (options.accept) input.accept = options.accept;
  if (options.folder) input.setAttribute("webkitdirectory", "");
  input.addEventListener("change", () => {
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length > 0) on_pick(files);
  });
  const visible = button(label, () => input.click());
  return el("span", undefined, visible, input);
}

const list_text = (items: string[] | undefined) => (items && items.length > 0 ? items.join(", ") : "none");

function snippet_card(snippet: SnippetPreview, review: Review, session: TransferSession): HTMLElement {
  const box = el("input", undefined) as HTMLInputElement;
  box.type = "checkbox";
  box.checked = review.accepted.has(snippet.path);
  box.disabled = snippet.problems.length > 0;
  box.setAttribute("data-snippet", snippet.path);
  box.addEventListener("change", () => session.accept(snippet.path, box.checked));
  return el(
    "div",
    "desertfox-transfer-snippet",
    el("label", undefined, box, ` Accept `, el("code", undefined, snippet.path), snippet.replaces ? " (replaces the installed one)" : ""),
    el("div", "desertfox-help-muted", `matches: ${list_text(snippet.matches)}; requires: ${list_text(snippet.requires)}`),
    ...snippet.problems.map((problem) => el("div", "desertfox-settings-error", problem)),
    el("pre", "desertfox-transfer-code", snippet.code),
  );
}

function review_view(review: Review, session: TransferSession): HTMLElement {
  const { preview } = review;
  const config_line = preview.config_files.length > 0
    ? `The config files (${preview.config_files.join(", ")}) replace the ones in force. Your saved edits stay on top.`
    : "The import holds no config files, so the config stays.";
  return el(
    "div",
    "desertfox-transfer-review",
    el("h3", undefined, "Review the import"),
    el("p", undefined, config_line),
    ...preview.problems.map((problem) => el("div", "desertfox-settings-error", problem)),
    ...preview.warnings.map((warning) => el("div", "desertfox-help-muted", warning)),
    ...(preview.snippets.length > 0
      ? [el("p", "desertfox-transfer-warning", SNIPPET_WARNING), el("p", undefined, "No snippet is stored until you accept it here. Snippets you leave unticked are dropped."), ...preview.snippets.map((snippet) => snippet_card(snippet, review, session))]
      : []),
    el("div", "desertfox-settings-body", button("Import", () => void session.commit(), !can_commit(review) || session.state.busy), button("Cancel", () => session.cancel())),
  );
}

function installed_row(snippet: InstalledSnippet, session: TransferSession): HTMLElement {
  const remove = button("Remove", () => void session.remove(snippet.path), session.state.busy);
  remove.setAttribute("aria-label", `Remove ${snippet.path}`);
  return el(
    "div",
    "desertfox-transfer-installed",
    el("code", undefined, snippet.path),
    el("span", "desertfox-help-muted", snippet.id === undefined ? " header does not parse" : ` ${snippet.label ?? snippet.id}; matches: ${list_text(snippet.matches)}; requires: ${list_text(snippet.requires)}`),
    remove,
  );
}

// Fills `container` and redraws it on every change of the session. Returns the session for tests and for the caller.
export function mount_transfer(container: HTMLElement, send: TransferDeps["send"]): TransferSession {
  const message = el("div", "desertfox-settings-message");
  message.setAttribute("role", "status");
  const tools = el("div", "desertfox-settings-body");
  const review_box = el("div", undefined);
  const installed_box = el("div", undefined);
  const draw = () => {
    const { state } = session;
    message.textContent = state.message?.text ?? "";
    message.classList.toggle("desertfox-settings-error", state.message?.ok === false);
    review_box.replaceChildren(...(state.review ? [review_view(state.review, session)] : []));
    installed_box.replaceChildren(
      el("h3", undefined, "Installed snippets"),
      ...(state.snippets.length > 0 ? state.snippets.map((snippet) => installed_row(snippet, session)) : [el("p", "desertfox-help-muted", "No snippet is installed.")]),
    );
  };
  const session: TransferSession = create_transfer_session({ send, on_change: draw });
  const export_button = (label: string, which: "config" | "snippets") =>
    button(label, () => void session.export_zip(which).then((file) => file && download(file)));
  tools.append(
    export_button("Export config", "config"),
    export_button("Export snippets", "snippets"),
    picker("Import a zip", "import-zip", (files) => void session.choose(() => read_zip_file(files[0]!)), { accept: ".zip,application/zip" }),
    picker("Import a folder", "import-folder", (files) => void session.choose(() => read_folder_files(files)), { folder: true }),
  );
  container.replaceChildren(tools, message, review_box, installed_box);
  draw();
  void session.load_snippets();
  return session;
}
