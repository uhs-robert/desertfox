// The `text` bundle: records the text typed in an insert session and writes it back for `.`. It loads on the first input event in a text field.

import type { BundleHostApi } from "../bundle_host.ts";
import { write_into_field } from "./field_writer.ts";
import { take_text_entry } from "./entry.ts";
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
    record: (invocations) => void browser.runtime.sendMessage({ type: "record_step", invocations, outcome: { ok: true } }),
  });
  host.register_handler_("text.input", (args) => {
    const { inputType, data } = args.event_ as InputEvent;
    recorder.on_input({ input_type: inputType, data, field: args.field_ as Element });
  });
  host.register_handler_("text.flush", recorder.flush);
  host.register_handler_("text.insert", (args) => recorder.while_replaying(() => write_into_field(args.text as string, host.last_blurred_())));
  // Escape and a click both blur the field. A tab that goes away flushes on the way out, as far as the message gets through.
  window.addEventListener("focusout", recorder.flush, true);
  window.addEventListener("pagehide", recorder.flush);
}
