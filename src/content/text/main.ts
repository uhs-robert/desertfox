// The `text` bundle: records the text typed in an insert session and writes it back for `.`. It loads on the first input event in a text field.

import type { BundleHostApi } from "../bundle_host.ts";
import { RuntimeRefusal } from "../../shared/command.ts";
import type { RegisterRead } from "../../shared/messages.ts";
import { deepest_focused_element } from "../editable.ts";
import { write_into_field } from "./field_writer.ts";
import { take_text_entry } from "./entry.ts";
import { read_field_text } from "./field_text.ts";
import { create_text_recorder } from "./recorder.ts";
import { is_secret_field } from "./secret_field.ts";

type TextWindow = { desertfox_host: BundleHostApi; desertfox_text_ready?: true };
const page = window as unknown as TextWindow;

// A second run would listen twice for nothing.
if (!page.desertfox_text_ready) {
  page.desertfox_text_ready = true;
  const host = page.desertfox_host;
  const recorder = create_text_recorder({
    is_secret: is_secret_field,
    take_entry: take_text_entry,
    read_text: read_field_text,
    record: (invocations) => void browser.runtime.sendMessage({ type: "record_step", invocations, outcome: { ok: true } }),
  });
  host.register_handler_("text.input", (args) => {
    // A cancelled answer tells the content script that no session is open, so the next edit comes through.
    return recorder.on_input(args.field_ as Element, args.before_ as string, args.type_ as string, args.autocomplete_ as string) ? undefined : { ok: true, cancelled: true };
  });
  host.register_handler_("text.flush", (args) => recorder.flush(args.after_ as string | undefined));
  host.register_handler_("register.paste", async (args) => {
    const name = args.name as string;
    const target = deepest_focused_element();
    const value = (await browser.runtime.sendMessage({ type: "register_read", name } satisfies RegisterRead)) as string | unknown[] | undefined;
    if (typeof value !== "string" || value === "") throw new RuntimeRefusal(value === undefined || value === "" ? `Register ${name} is empty` : `Register ${name} holds a macro, not text`);
    // The read is async and keys are not held, so focus may have moved on to a field the user did not paste into.
    if (deepest_focused_element() !== target) throw new RuntimeRefusal("Focus moved while the register was read");
    // Escape in a contenteditable body leaves it focused, so the same-field check passes after insert mode ended.
    if (host.get_mode() !== "insert") throw new RuntimeRefusal("Insert mode ended while the register was read");
    // Outside `while_replaying`: the text joins the insert session that `.` repeats, as a paste from the keyboard would.
    write_into_field(value, host.last_blurred_());
  });
  host.register_handler_("text.insert", (args) => recorder.while_replaying(() => write_into_field(args.text as string, host.last_blurred_())));
  // Escape and a click both blur the field. A tab that goes away flushes on the way out, as far as the message gets through.
  // Not `recorder.flush` itself, which would take the event as the field's text.
  const flush_now = () => recorder.flush();
  window.addEventListener("focusout", flush_now, true);
  window.addEventListener("pagehide", flush_now);
}
