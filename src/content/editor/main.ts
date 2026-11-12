// The `editor` bundle: registers `text.edit_external`. It hands the focused field's text to the background, which runs the user's editor through the native host, and writes the result back when the background says the editor ended.

import type { BundleHostApi } from "../bundle_host.ts";
import { deepest_focused_element, is_editable_element } from "../editable.ts";
import { read_field_text } from "../text/field_text.ts";
import { is_secret_field } from "../text/secret_field.ts";
import { RuntimeRefusal } from "../../shared/command.ts";
import type { BackgroundToContent, EditorAnswer, EditorDone, EditorOpen } from "../../shared/messages.ts";

// The host refuses more than this many bytes of text, so a longer field is refused here and no doomed request goes out.
const MAX_EDITOR_BYTES = 128 * 1024;

type EditorWindow = { desertfox_host?: BundleHostApi; desertfox_editor_ready?: true };
const page = window as unknown as EditorWindow;

// What a page waits for, by token. It holds the field and its text at the press, so the result goes in only while the field still holds that text. A navigation drops the page and with it the map.
const open_edits = new Map<string, { field: Element; original: string }>();

// `insertText` over the whole content is a real edit, so React and Vue fields see an input event and undo keeps working. An empty result needs `delete`, which `insertText` refuses.
function replace_content(field: Element, text: string): boolean {
  (field as HTMLElement).focus();
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.select();
  else getSelection()?.selectAllChildren(field);
  return text === "" ? document.execCommand("delete") : document.execCommand("insertText", false, text);
}

function finish(host: BundleHostApi, { token, text }: EditorDone): void {
  const edit = open_edits.get(token);
  if (!edit) return;
  open_edits.delete(token);
  if (text === undefined) return;
  if (edit.field.isConnected && read_field_text(edit.field) === edit.original && replace_content(edit.field, text)) return;
  // The field moved on while the editor was open: the edited text must not be lost, and must not overwrite the newer text.
  void browser.runtime.sendMessage({ type: "register_yank", name: "", text });
  host.show_toast_('The field changed while the editor was open. The edited text is in the unnamed register: paste it with <C-r>"');
}

async function edit_external(host: BundleHostApi, args: Record<string, unknown>): Promise<void> {
  const field = deepest_focused_element();
  if (!field || !is_editable_element(field)) throw new RuntimeRefusal("No text field is focused");
  if (is_secret_field(field)) throw new RuntimeRefusal("A password field is not opened in an external editor");
  const text = read_field_text(field);
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_EDITOR_BYTES) throw new RuntimeRefusal(`The field holds ${Math.ceil(bytes / 1024)} KiB, over the ${MAX_EDITOR_BYTES / 1024} KiB the external editor takes`);
  const token = crypto.randomUUID();
  // Registered before the send, because a quick editor can end before the answer to the send arrives.
  open_edits.set(token, { field, original: text });
  const request: EditorOpen = { type: "editor_open", token, text, insert: args.insert === true, ...(typeof args.ext === "string" ? { ext: args.ext } : {}) };
  const answer = (await browser.runtime.sendMessage(request).catch((error: unknown) => ({ ok: false, message: String(error) }))) as EditorAnswer;
  if (!answer.ok) {
    open_edits.delete(token);
    throw new RuntimeRefusal(answer.message);
  }
}

// A second run would register again for nothing. With no host, content.js has not started in this frame, and the load it asks for later registers.
const host = page.desertfox_host;
if (!page.desertfox_editor_ready && host) {
  page.desertfox_editor_ready = true;
  host.register_handler_("text.edit_external", (args) => edit_external(host, args));
  // Returns nothing for every other message, so the other listeners answer those.
  browser.runtime.onMessage.addListener((message: BackgroundToContent) => {
    if (message.type !== "editor_done") return undefined;
    finish(host, message);
    return Promise.resolve();
  });
}
