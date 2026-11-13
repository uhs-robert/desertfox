// Draws the Keys section of the settings page from a keys session (`keys_model.ts`), and holds the key capture that lets the capture box take keys the content script would otherwise run.

import { el } from "./render.ts";
import { button } from "./transfer_page.ts";
import { actions_of, create_keys_session, is_read_only, matches_filter, READ_ONLY_ROW_NOTE, RESERVED_CHORDS_NOTE, row_id } from "./keys_model.ts";
import type { CheckView, Editor, KeysDeps, KeysSession } from "./keys_model.ts";
import type { BindingRow } from "../shared/messages.ts";
import type { KeymapMode } from "../shared/keymap.ts";
import { KEYMAP_MODES } from "../shared/config_build/merge.ts";
import { event_to_token } from "../shared/keys/token.ts";
import { touches_settings } from "../shared/storage_watch.ts";

export type CaptureHandlers = { token: (token: string) => void; backspace: () => void; cancel: () => void; save: () => void };

// The one window keydown listener of the capture box, registered by `main.ts` before `content.js` and the drawer's Escape handler load, so it runs first.
// A listener added on focus would run after the content script's, which has already run the key. This one does nothing unless a box holds focus, and `bind` is the only way to make one active.
export function create_key_capture() {
  let active: { node: HTMLElement; handlers: CaptureHandlers } | undefined;

  const on_keydown = (event: KeyboardEvent): void => {
    // A box that left the page, or lost focus without a blur event, takes no key.
    if (!active || !active.node.isConnected || document.activeElement !== active.node) {
      active = undefined;
      return;
    }
    const { handlers } = active;
    const plain = !(event.ctrlKey || event.altKey || event.metaKey || event.shiftKey);
    // Tab and Shift+Tab move the focus as usual, so the box never traps the keyboard.
    if (event.key === "Tab" && !(event.ctrlKey || event.altKey || event.metaKey)) return;
    const token = event_to_token(event);
    // A modifier on its own, a dead key and an IME key press end up here: swallowed, nothing captured.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (plain && event.key === "Escape") handlers.cancel();
    else if (plain && event.key === "Backspace") handlers.backspace();
    else if (plain && event.key === "Enter") handlers.save();
    else if (token !== null) handlers.token(token);
  };

  // The box is active from its focus to its blur, and `release` ends that early. A second `bind` replaces the first.
  function bind(node: HTMLElement, handlers: CaptureHandlers): () => void {
    const own = { node, handlers };
    const take = () => {
      active = own;
    };
    const drop = () => {
      if (active === own) active = undefined;
    };
    node.addEventListener("focus", take);
    node.addEventListener("blur", drop);
    // A box that already has focus when it is bound.
    if (document.activeElement === node) take();
    return () => {
      node.removeEventListener("focus", take);
      node.removeEventListener("blur", drop);
      drop();
    };
  }

  return { on_keydown, bind };
}

export type KeyCapture = ReturnType<typeof create_key_capture>;

type StorageChangedEvents = { addListener: (listener: (changes: Record<string, unknown>, area: string) => void) => void; removeListener: (listener: (changes: Record<string, unknown>, area: string) => void) => void };

const with_data_keys = <T extends HTMLElement>(node: T, name: string): T => {
  node.setAttribute("data-keys", name);
  return node;
};

function check_lines(check: CheckView, saves_hint: boolean): HTMLElement[] {
  switch (check.state) {
    case "waiting": return [];
    case "checking": return [el("div", "desertfox-help-muted", "Checking...")];
    case "failed": return [el("div", "desertfox-settings-error", check.message)];
    case "done": {
      const lines: HTMLElement[] = [];
      for (const problem of check.problems) lines.push(el("div", "desertfox-settings-error", problem));
      for (const warning of check.warnings) lines.push(el("div", "desertfox-settings-error", warning));
      for (const shadow of check.shadows) lines.push(el("div", "desertfox-help-muted", `Replaces or drops ${shadow.keys}, which runs ${shadow.text || "nothing"}.`));
      if (check.problems.length === 0 && saves_hint) lines.push(el("div", "desertfox-help-muted", check.saves ? "This saves." : "This is not saved."));
      return lines;
    }
  }
}

// Draws the section into `container`. The returned function stops the storage listener, the check timer and the capture, and the router calls it before it rebuilds the body.
export function mount_keys(container: HTMLElement, deps: Omit<KeysDeps, "on_change">, capture: KeyCapture, storage_changed: StorageChangedEvents): () => void {
  let session: KeysSession;
  let stopped = false;
  let release_capture: () => void = () => undefined;

  const filter = el("input", "desertfox-settings-input") as HTMLInputElement;
  filter.type = "search";
  filter.placeholder = "Filter by keys, command or mode";
  filter.setAttribute("aria-label", "Filter bindings");
  with_data_keys(filter, "filter");
  filter.addEventListener("input", () => session.set_filter(filter.value));
  const status = with_data_keys(el("p", "desertfox-settings-error"), "status");
  status.setAttribute("role", "status");
  const tables = el("div", "desertfox-keys-tables");

  // The editor is built once and moved under the open row, so a refresh that redraws the rows never rebuilds a box the user is typing in.
  const capture_box = with_data_keys(el("div", "desertfox-settings-input desertfox-keys-capture"), "capture");
  capture_box.tabIndex = 0;
  capture_box.setAttribute("role", "group");
  capture_box.setAttribute("aria-label", "Key sequence, press the keys");
  const command = with_data_keys(el("input", "desertfox-settings-input desertfox-keys-command"), "command") as HTMLInputElement;
  command.type = "text";
  command.setAttribute("aria-label", "Command");
  command.setAttribute("list", "desertfox-keys-names");
  command.setAttribute("autocomplete", "off");
  command.spellcheck = false;
  const names = el("datalist", undefined);
  names.id = "desertfox-keys-names";
  const check_box = with_data_keys(el("div", "desertfox-keys-check"), "check");
  check_box.setAttribute("role", "status");
  const message_box = with_data_keys(el("div", undefined), "message");
  message_box.setAttribute("role", "status");
  const note_box = el("div", "desertfox-help-muted");
  const clear = with_data_keys(button("Clear", () => {
    session.clear_keys();
    capture_box.focus();
  }), "clear");
  const save = with_data_keys(button("Save", () => void session.save()), "save");
  const remove = with_data_keys(button("Remove", () => void session.remove()), "remove");
  const reset = with_data_keys(button("Reset", () => void session.reset()), "reset");
  const close = with_data_keys(button("Close", () => session.close()), "close");
  command.addEventListener("input", () => session.set_text(command.value));
  command.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void session.save();
  });
  const editor_cell = el("td", "desertfox-keys-editor-cell", el("div", "desertfox-keys-editor-line", capture_box, clear), el("div", "desertfox-keys-editor-line", command, names), note_box, check_box, el("div", "desertfox-keys-editor-line", save, remove, reset, close), message_box);
  editor_cell.setAttribute("colspan", "3");
  const editor_row = with_data_keys(el("tr", "desertfox-keys-editor", editor_cell), "editor");
  release_capture = capture.bind(capture_box, {
    token: (token) => session.capture(token),
    backspace: () => session.capture_backspace(),
    save: () => void session.save(),
    cancel: () => {
      session.cancel_capture();
      capture_box.blur();
    },
  });

  function sync_editor(editor: Editor): void {
    const shown = JSON.stringify(editor.tokens);
    if (capture_box.getAttribute("data-shown") !== shown) {
      capture_box.setAttribute("data-shown", shown);
      capture_box.replaceChildren(...(editor.tokens.length === 0 ? [el("span", "desertfox-help-muted", "Press the keys")] : editor.tokens.map((token) => el("kbd", undefined, token))));
    }
    // The typed text stays as typed. It is written only when the model changed it, for example a refresh of another tab's row.
    if (command.value !== editor.text) command.value = editor.text;
    const read_only = editor.original !== undefined && is_read_only(editor.original);
    command.readOnly = read_only;
    note_box.textContent = read_only ? READ_ONLY_ROW_NOTE : RESERVED_CHORDS_NOTE;
    const actions = actions_of(editor);
    save.disabled = !actions.save;
    remove.disabled = !actions.remove;
    reset.disabled = !actions.reset;
    remove.hidden = editor.original === undefined;
    reset.hidden = editor.original === undefined || !(editor.original.origin === "edit" || editor.original.origin === "removed");
    clear.disabled = editor.busy || read_only;
    check_box.replaceChildren(...check_lines(editor.check, editor.original === undefined || actions.save));
    message_box.textContent = editor.message?.text ?? "";
    message_box.className = editor.message?.ok === false ? "desertfox-settings-error" : "desertfox-help-muted";
    capture_box.setAttribute("aria-disabled", String(read_only));
  }

  const origin_label = (row: BindingRow): string => (row.origin === "file" ? "config file" : row.origin === "edit" ? "saved" : row.origin);

  function row_node(row: BindingRow): HTMLElement {
    const open = button("Edit", () => session.open_row(row));
    open.setAttribute("aria-label", `Edit ${row.keys} in ${row.mode} mode`);
    open.className = "desertfox-settings-reset";
    const text = row.text === "" ? el("span", "desertfox-help-muted", "(unbound)") : el("code", undefined, row.text);
    const tag = el("span", "desertfox-help-badge", origin_label(row));
    const cells = [el("td", undefined, el("kbd", undefined, row.keys)), el("td", undefined, text, " ", tag, ...(row.skipped ? [el("div", "desertfox-settings-error", row.skipped)] : [])), el("td", undefined, open)];
    const node = el("tr", "desertfox-keys-row", ...cells);
    node.setAttribute("data-keys-row", row_id(row.mode, row.keys));
    node.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("button")) return;
      session.open_row(row);
    });
    return node;
  }

  function mode_section(mode: KeymapMode, open: Editor | undefined): HTMLElement {
    const rows = session.state.rows.filter((row) => row.mode === mode && matches_filter(row, session.state.filter));
    const body: HTMLElement[] = [];
    if (open && open.mode === mode && open.original === undefined) body.push(editor_row);
    for (const row of rows) {
      body.push(row_node(row));
      if (open?.original && open.mode === mode && open.original.keys === row.keys) body.push(editor_row);
    }
    const add = with_data_keys(button("Add a binding", () => session.open_new(mode)), "add");
    add.setAttribute("data-mode", mode);
    const heading = el("h3", undefined, mode, " ", el("span", "desertfox-help-muted", `(${rows.length})`));
    const section = el("div", "desertfox-keys-mode", heading, add, body.length === 0 ? el("p", "desertfox-help-muted", "No bindings match.") : el("table", "desertfox-keys-table", ...body));
    section.setAttribute("data-keys-mode", mode);
    return section;
  }

  let focused_open = 0;

  function draw_rows(): void {
    const { open } = session.state;
    // Moving a focused node drops its focus, so the box or field that had it takes it back after the redraw.
    const had_focus = [capture_box, command].find((node) => node === document.activeElement);
    const keeps_place = open && editor_row.isConnected;
    status.textContent = session.state.error ?? "";
    names.replaceChildren(...session.state.names.map((name) => el("option", undefined, name)));
    tables.replaceChildren(...KEYMAP_MODES.map((mode) => mode_section(mode, open)));
    // An open row the filter hides leaves the editor out of the page, and the draft stays in the session.
    if (open) sync_editor(open);
    // A new open moves the focus into the capture box. A redraw of the same editor gives it back to what had it.
    if (open && session.state.opened !== focused_open && editor_row.isConnected) {
      focused_open = session.state.opened;
      capture_box.focus();
    } else if (had_focus && keeps_place && editor_row.isConnected) had_focus.focus();
  }

  session = create_keys_session({
    ...deps,
    on_change: (what) => {
      if (stopped) return;
      if (what === "rows") draw_rows();
      else if (session.state.open) sync_editor(session.state.open);
    },
  });
  container.replaceChildren(
    el("p", undefined, "Every binding, by mode. A click on a row opens its editor. Press the keys in the box, write the command as in the command line, and Save. An edit applies at once and survives a config reload. Remove unbinds a key, and Reset drops the edit."),
    el("div", "desertfox-keys-tools", filter),
    status,
    tables,
  );

  const listener = (changes: Record<string, unknown>, area: string) => {
    if (touches_settings(changes, area)) void session.refresh();
  };
  storage_changed.addListener(listener);
  void session.load();
  return () => {
    stopped = true;
    storage_changed.removeListener(listener);
    session.dispose();
    release_capture();
    release_capture = () => undefined;
  };
}
