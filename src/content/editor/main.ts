// The `editor` bundle: registers `text.edit_external`. It hands the focused field's text to the background, which runs the user's editor through the native host, and writes the result back when the background says the editor ended.

import type { BundleHostApi } from "../bundle_host.ts";
import { deepest_focused_element, is_editable_element } from "../editable.ts";
import { read_field_text } from "../text/field_text.ts";
import { type_at_caret } from "../text/field_writer.ts";
import { is_secret_field } from "../text/secret_field.ts";
import { CLIPBOARD_NOT_RESTORED, copy_through_clipboard, paste_through_clipboard, VIRTUALIZED_EDITOR } from "./clipboard_fallback.ts";
import { RuntimeRefusal } from "../../shared/command.ts";
import type { BackgroundToContent, EditorAnswer, EditorDone, EditorOpen } from "../../shared/messages.ts";
import { refused_as } from "../../shared/swallow.ts";

// The host refuses more than this many bytes of text, so a longer field is refused here and no doomed request goes out.
const MAX_EDITOR_BYTES = 128 * 1024;

type EditorWindow = { desertfox_host?: BundleHostApi; desertfox_editor_ready?: true };
const page = window as unknown as EditorWindow;

// What a page waits for, by token. It holds the field and its text at the press, so the result goes in only while the field still holds that text. A navigation drops the page and with it the map.
const open_edits = new Map<string, { field: Element; original: string; through_clipboard: boolean }>();

// A plain field takes the value through the native setter and `input` and `change` events, which is what a framework's own change tracking watches. An element that is editable by `contenteditable` takes one `insertText` over its whole content, so undo keeps working. An empty result needs `delete`, which `insertText` refuses.
function write_field(field: Element, text: string, original: string): boolean {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    const set_value = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set;
    if (!set_value) return false;
    set_value.call(field, text);
    // The field may sanitize the value (line breaks in a single-line input, a non-number in a number input), so what it holds is what counts.
    // The field is put back, so a refused write leaves the text it had.
    if (field.value !== text) {
      set_value.call(field, original);
      return false;
    }
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    // A page handler can put another value back during those events (a controlled input that rejects the change). The page owns the field then, so its value stays and the caller keeps the text in the register.
    return field.value === text;
  }
  getSelection()?.selectAllChildren(field);
  return text === "" ? document.execCommand("delete") : type_at_caret(text);
}

// Whether the page took the result. An unknown token is a page the result was not meant for.
function finish(host: BundleHostApi, { token, text }: EditorDone): Promise<boolean> {
  const edit = open_edits.get(token);
  if (!edit) return Promise.resolve(false);
  open_edits.delete(token);
  if (text === undefined || text === edit.original) return Promise.resolve(true);
  const { field, original } = edit;
  if (edit.through_clipboard) {
    return paste_through_clipboard(field as HTMLElement, text, original).then(async ({ outcome, restored }) => {
      const note = restored ? "" : `${CLIPBOARD_NOT_RESTORED}. `;
      if (outcome === "pasted") host.show_toast_(note || CLIPBOARD_USED_TOAST);
      else await keep_in_register(host, text, outcome, note);
      return true;
    });
  }
  const unchanged = () => field.isConnected && read_field_text(field) === original;
  let reason = "changed";
  if (unchanged()) {
    // A focus handler of the page can edit the field, so the check runs again before the write.
    (field as HTMLElement).focus();
    if (unchanged()) {
      if (write_field(field, text, original)) return Promise.resolve(true);
      reason = "refused";
    }
  }
  return keep_in_register(host, text, reason).then(() => true);
}

// The edited text must not be lost, and must not overwrite the newer text. The toast says so only when the register took it.
async function keep_in_register(host: BundleHostApi, text: string, reason: string, note = ""): Promise<void> {
  const saved = (await refused_as(browser.runtime.sendMessage({ type: "register_yank", name: "", text }), undefined)) as { ok?: boolean; message?: string } | undefined;
  if (saved?.ok !== true) return host.show_toast_(`${note}The edited text (${text.length} characters) could not be saved to a register${saved?.message ? `: ${saved.message}` : ""}`);
  const why = reason === "changed" ? "The field changed while the editor was open." : "The field did not take the edited text.";
  host.show_toast_(`${note}${why} The edited text is in the unnamed register: paste it with <C-r>"`);
}

async function edit_external(host: BundleHostApi, args: Record<string, unknown>): Promise<void> {
  const field = deepest_focused_element();
  if (!field || !is_editable_element(field)) throw new RuntimeRefusal("No text field is focused");
  if (is_secret_field(field)) throw new RuntimeRefusal("A password field is not opened in an external editor");
  const through_clipboard = field.closest(VIRTUALIZED_EDITOR) !== null;
  if (!through_clipboard) return open_in_editor(field, read_field_text(field), false, args);
  const text = await copy_through_clipboard(field as HTMLElement);
  // The clipboard was used even when the open is refused after the copy, so the refusal says so too.
  await open_in_editor(field, text, true, args).catch((error: Error) => {
    throw new RuntimeRefusal(`${error.message}. ${CLIPBOARD_USED_TOAST}`);
  });
  host.show_toast_(CLIPBOARD_USED_TOAST);
}

async function open_in_editor(field: Element, text: string, through_clipboard: boolean, args: Record<string, unknown>): Promise<void> {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_EDITOR_BYTES) throw new RuntimeRefusal(`The field holds ${Math.ceil(bytes / 1024)} KiB, over the ${MAX_EDITOR_BYTES / 1024} KiB the external editor takes`);
  const token = crypto.randomUUID();
  // Registered before the send, because a quick editor can end before the answer to the send arrives.
  open_edits.set(token, { field, original: text, through_clipboard });
  const request: EditorOpen = { type: "editor_open", token, text, insert: args.insert === true, ...(typeof args.ext === "string" ? { ext: args.ext } : {}) };
  const answer = (await browser.runtime.sendMessage(request).catch((error: unknown) => ({ ok: false, message: String(error) }))) as EditorAnswer;
  if (!answer.ok) {
    open_edits.delete(token);
    throw new RuntimeRefusal(answer.message);
  }
}

const CLIPBOARD_USED_TOAST = "Used the clipboard. Its text is back, an image or HTML on it is lost";

// A second run would register again for nothing. With no host, content.js has not started in this frame, and the load it asks for later registers.
const host = page.desertfox_host;
if (!page.desertfox_editor_ready && host) {
  page.desertfox_editor_ready = true;
  host.register_handler_("text.edit_external", (args) => edit_external(host, args));
  // Returns nothing for every other message, so the other listeners answer those.
  browser.runtime.onMessage.addListener((message: BackgroundToContent) => {
    if (message.type !== "editor_done") return undefined;
    return finish(host, message);
  });
}
