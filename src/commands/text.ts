import { define } from "../shared/registry/builtin.ts";

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
