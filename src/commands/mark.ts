import { define } from "../shared/registry/builtin.ts";
import { is_global_mark, MARK_ADD_KEY, MARK_JUMP_KEY } from "../shared/mark_names.ts";

// Both run in the `page` bundle, which stores and reads marks through the background. Only the page can read its scroll position.
define("mark.add", {
  label: "Set mark",
  intent: "Remember the scroll position of this page under a letter. A lowercase letter marks this page. An uppercase letter is global: a jump goes to the tab that has this address, or opens it. Setting the letter again replaces it.",
  params: [{ name: "key", type: "key", pattern: MARK_ADD_KEY.source, description: "Name the mark with this letter, a-z or A-Z." }],
  bridge: false,
  runs_in: "content",
  bundle: "page",
  repeatable: false,
});

define("mark.jump", {
  label: "Jump to mark",
  intent: "Scroll to a mark, or go to the tab of a global mark. The position you left becomes the mark `'`, so `''` jumps back and forth. Only mark jumps set it.",
  params: [{ name: "key", type: "key", pattern: MARK_JUMP_KEY.source, description: "Jump to this mark, a-z or A-Z. `'` is the last position." }],
  bridge: false,
  runs_in: "content",
  bundle: "page",
  repeatable: false,
  // A global mark jumps in the top frame or another tab, whichever frame asked.
  jumps: (args) => (is_global_mark(args.key as string) ? "top_frame" : true),
});
