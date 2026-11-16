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

define("mark.step", {
  label: "Step to mark",
  intent: "Scroll to the next mark below or the previous mark above. It uses the marks of this page, by scroll position. A global mark counts on the page it names, and the previous-position mark `'` never counts. It stops with a notice when no mark lies that way. A count moves that many marks and stops on the last one. It does not wrap and it leaves `'` alone.",
  params: [
    { name: "direction", type: "enum", values: ["next", "prev"], value_labels: { next: "to next mark", prev: "to previous mark" }, description: { next: "Scroll to the nearest mark below.", prev: "Scroll to the nearest mark above." } },
    { name: "steps", type: "int", default: 1, min: 1, description: "Move this many marks." },
  ],
  bridge: false,
  runs_in: "content",
  count: { param: "steps" },
  bundle: "page",
  jumps: true,
});

define("mark.jump", {
  label: "Jump to mark",
  intent: "Scroll to a mark, or go to the tab of a global mark. The position you left becomes the mark `'`, so `''` jumps back and forth. Only mark jumps set it.",
  params: [{ name: "key", type: "key", pattern: MARK_JUMP_KEY.source, description: "Jump to this mark, a-z or A-Z. `'` is the last position." }],
  bridge: false,
  runs_in: "content",
  bundle: "page",
  repeatable: false,
  // A global mark can land in another window, which only the background knows, so `global_mark_jump.ts` records it.
  jumps: (args) => !is_global_mark(args.key as string),
});
