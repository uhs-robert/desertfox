import { define } from "../shared/registry/builtin.ts";
import { REGISTER_KEY } from "../shared/register_names.ts";

// The recorder stores the text of one insert session as this command, and `.` runs it. Its code sits in the `text` bundle.
define("text.insert", {
  completion: "hidden",
  label: "Insert text",
  intent: "Type text into a text field. It uses the focused field, else the one Escape left. A count types the text that many times.",
  params: [{ name: "text", type: "string", main: true, description: "Type this text." }],
  bridge: false,
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
  bridge: false,
  runs_in: "content",
  modes: ["insert"],
  // The pasted text is part of the insert session, so `text.insert` is what `.` repeats.
  repeatable: false,
  bundle: "text",
});

// The insert mode key `<C-o>`. The host runs the editor the user's config names: the request carries text only. The code sits in the `editor` bundle, and the background holds the job.
define("text.edit_external", {
  label: "Edit in external editor",
  intent: "Edit the focused field in the native host's external editor.",
  params: [
    { name: "ext", type: "string", optional: true, pattern: "^[A-Za-z0-9]{1,10}$", description: "Extension of the scratch file, for the editor filetype." },
    { name: "insert", type: "bool", default: false, description: "Start the editor in insert mode at the end." },
  ],
  bridge: false,
  runs_in: "content",
  modes: ["insert"],
  repeatable: false,
  bundle: "editor",
});
