import { define } from "../shared/registry/builtin.ts";
import { REGISTER_KEY } from "../shared/register_names.ts";

// The recorder stores the text of one insert session as this command, and `.` runs it. Its code sits in the `text` bundle.
define("text.insert", {
  completion: "hidden",
  label: "Insert text",
  intent: "Type text into a text field. It uses the focused field, else the one Escape left. A count types the text that many times.",
  params: [{ name: "text", type: "string", main: true, description: "Type this text." }],
  runs_in: "content",
  count: "repeat",
  bundle: "text",
});

// The insert mode key `<C-r>` waits for a register key and types that register's text, as in vim.
define("register.paste", {
  completion: "hidden",
  label: "Paste register",
  intent: "Type the text of a register into a text field. It uses the focused field, else the one Escape left. A register that holds a macro has no text.",
  params: [{ name: "name", type: "key", pattern: REGISTER_KEY.source, description: "Paste this register." }],
  runs_in: "content",
  modes: ["insert"],
  // The pasted text is part of the insert session, so `text.insert` is what `.` repeats.
  repeatable: false,
  bundle: "text",
});
