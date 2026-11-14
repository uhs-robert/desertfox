// Draws the import-a-theme section under the theme picker from a themes session (`themes_model.ts`): a box for pasted text or a picked file,
// a live preview of the hint label, mode badges, toasts and which-key panel in the scheme's colors, and the list of imported themes with a Remove button each.

import { el } from "./render.ts";
import { button, picker } from "./transfer_page.ts";
import { can_save, create_themes_session, name_problem } from "./themes_model.ts";
import type { ThemesDeps, ThemesSession } from "./themes_model.ts";
import type { ImportedScheme } from "../shared/theme/base16.ts";
import { role_tokens } from "../shared/theme/tokens.ts";
import { THEME_EDITS_STORAGE_KEY } from "../background/storage_keys.ts";

type StorageChangedEvents = { addListener: (listener: (changes: Record<string, unknown>, area: string) => void) => void; removeListener: (listener: (changes: Record<string, unknown>, area: string) => void) => void };

const MODE_BADGES: [label: string, role: string][] = [["NORMAL", "mode-normal"], ["INSERT", "mode-insert"], ["IGNORE", "mode-ignore"], ["CARET", "mode-caret"], ["VISUAL", "mode-visual"]];
const TOASTS: [kind: string, text: string][] = [["success", "Saved the setting"], ["info", "3 tabs closed"], ["warning", "The page has no links"], ["error", "That command needs a tab"]];
const WHICH_KEY_ROWS: [key: string, label: string, group: boolean][] = [["g", "go to", true], ["t", "new tab", false], ["x", "close tab", false], ["/", "search page", false]];

// The mock surfaces use the same `--desertfox-*` tokens as the real ones, set on the stage only, so the page around it keeps the theme in force.
export function preview_view(scheme: ImportedScheme): HTMLElement {
  const stage = el("div", "desertfox-theme-preview");
  for (const [token, value] of Object.entries(role_tokens(scheme.theme.dark))) stage.style.setProperty(token, value);
  const search = el("div", "desertfox-preview-line", "Find in page: ", el("span", "desertfox-preview-search", "match"), " and ", el("span", "desertfox-preview-search desertfox-preview-search-current", "current match"));
  const hints = el("div", "desertfox-preview-line", "Hints: ", ...["A", "SD", "JK"].map((label) => el("span", "desertfox-preview-hint", label)));
  const badges = el("div", "desertfox-preview-line", "Modes: ", ...MODE_BADGES.map(([label, role]) => el("span", `desertfox-preview-badge desertfox-preview-${role}`, label)));
  const toasts = el("div", "desertfox-preview-toasts", ...TOASTS.map(([kind, text]) => el("div", `desertfox-preview-toast desertfox-preview-toast-${kind}`, text)));
  const keys = el("div", "desertfox-preview-whichkey", ...WHICH_KEY_ROWS.map(([key, label, group]) => el("div", group ? "desertfox-preview-whichkey-group" : undefined, el("span", "desertfox-preview-whichkey-key", key), ` ${label}`)));
  stage.append(el("div", "desertfox-preview-columns", el("div", undefined, hints, badges, search, toasts), keys));
  return stage;
}

const variant_note = (scheme: ImportedScheme): string =>
  `${scheme.system} scheme, ${scheme.variant_known ? scheme.variant : `read as ${scheme.variant} from its colors`}. It fills both the dark and the light setting, so your system mode does not change it.`;

export function mount_themes(container: HTMLElement, deps: Omit<ThemesDeps, "on_change">, storage_changed: StorageChangedEvents): () => void {
  let session: ThemesSession;
  let stopped = false;

  const text_box = el("textarea", "desertfox-files-text") as HTMLTextAreaElement;
  text_box.rows = 8;
  text_box.spellcheck = false;
  text_box.placeholder = 'Paste a base16 or base24 scheme here, for example:\nscheme: "Example"\nbase00: "1e1e2e"\nbase01: "181825"\n...';
  text_box.setAttribute("aria-label", "color scheme text");
  text_box.addEventListener("input", () => session.set_text(text_box.value));
  const name_box = el("input", "desertfox-settings-input") as HTMLInputElement;
  name_box.type = "text";
  name_box.spellcheck = false;
  name_box.setAttribute("autocomplete", "off");
  name_box.setAttribute("aria-label", "theme name");
  name_box.addEventListener("input", () => session.set_name(name_box.value));
  name_box.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void session.save();
  });
  const problem = el("div", "desertfox-settings-error");
  problem.setAttribute("role", "status");
  const note = el("p", "desertfox-help-muted");
  const preview_box = el("div", undefined);
  const save = button("Save theme", () => void session.save());
  const clear = button("Clear", () => session.clear());
  const confirm_box = el("div", "desertfox-settings-body");
  const message = el("div", undefined);
  message.setAttribute("role", "status");
  const status = el("p", "desertfox-settings-error");
  const list = el("div", "desertfox-engines-list");

  function draw(): void {
    if (stopped) return;
    const { state } = session;
    status.textContent = state.error ?? "";
    if (text_box.value !== state.text) text_box.value = state.text;
    if (name_box.value !== state.name) name_box.value = state.name;
    const name_issue = name_problem(state);
    problem.replaceChildren(...[state.text_problem, name_issue].filter((text): text is string => text !== undefined).map((text) => el("div", undefined, text)));
    name_box.setAttribute("aria-invalid", String(name_issue !== undefined));
    note.textContent = state.scheme ? variant_note(state.scheme) : "";
    preview_box.replaceChildren(...(state.scheme ? [preview_view(state.scheme)] : []));
    save.disabled = !can_save(state) || state.replacing !== undefined;
    confirm_box.replaceChildren(
      ...(state.replacing === undefined
        ? []
        : [el("span", undefined, `A theme named ${state.replacing} is already imported. Replace it?`), button("Replace", () => void session.confirm_replace(), state.busy), button("Keep the old one", () => session.cancel_replace())]),
    );
    message.textContent = state.message?.text ?? "";
    message.className = state.message?.ok === false ? "desertfox-settings-error" : "desertfox-help-muted";
    if (state.names.length === 0) {
      list.replaceChildren(el("p", "desertfox-help-muted", state.loaded ? "You have imported no theme yet." : "Loading..."));
      return;
    }
    const rows = state.names.map((name) => {
      const remove = button("Remove", () => void session.remove(name), state.busy);
      remove.setAttribute("aria-label", `Remove the theme ${name}`);
      return el("tr", undefined, el("td", undefined, el("code", undefined, name)), el("td", undefined, remove));
    });
    list.replaceChildren(el("h4", undefined, "Imported themes"), el("table", "desertfox-keys-table", ...rows));
  }

  session = create_themes_session({ ...deps, on_change: draw });
  const file_picker = picker("Choose a file", "import-theme", (files) => void session.load_file(files[0]!), { accept: ".yaml,.yml,text/yaml,text/plain" });
  container.replaceChildren(
    el("div", "desertfox-settings-body", file_picker, " or paste the scheme text:"),
    text_box,
    el("div", "desertfox-engines-form", el("label", "desertfox-engines-field", el("span", "desertfox-help-muted", "Theme name"), name_box), el("div", "desertfox-keys-editor-line", save, clear)),
    problem,
    note,
    preview_box,
    confirm_box,
    message,
    status,
    list,
  );
  draw();
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === "local" && THEME_EDITS_STORAGE_KEY in changes) void session.refresh();
  };
  storage_changed.addListener(listener);
  void session.refresh();
  return () => {
    stopped = true;
    storage_changed.removeListener(listener);
  };
}
