import { define } from "../shared/registry/builtin.ts";

// The hints bundle takes these keys itself while hint mode is open. The binding exists so the content script holds the key while the bundle loads, and the handler only answers a key the bundle did not take.
define("hint.key", {
  completion: "hidden",
  label: "Hint key",
  intent: "Take a key that hint mode uses for text. Slash switches from typing a label to typing text, and Backspace on empty text switches back. In text mode Tab and Shift-Tab move the active hint and Enter picks it. In label mode Space turns overlapping labels.",
  params: [
    {
      name: "key",
      type: "enum",
      values: ["slash", "tab", "shift_tab", "enter", "space"],
      value_labels: { slash: "/", tab: "Tab", shift_tab: "Shift-Tab", enter: "Enter", space: "Space" },
      description: { slash: "Switch to typing link text.", tab: "Move to the next match.", shift_tab: "Move to the previous match.", enter: "Pick the active match.", space: "Turn overlapping labels, or add a space to the text." },
    },
  ],
  bridge: false,
  runs_in: "content",
  bundle: "hints",
  repeatable: false,
  modes: ["hint"],
});
