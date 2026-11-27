import { define } from "../shared/registry/builtin.ts";

// The hints bundle takes these keys itself while hint mode is open. The binding of Tab, Enter and Space exists so the content script holds the key while the bundle loads. Slash is held as a one-character key and is bound for its which-key label, and the handler only answers a key the bundle did not take.
define("hint.key", {
  completion: "hidden",
  label: "Hint key",
  intent: "Take a key that hint mode uses for text. Slash switches from typing a label to typing text, and Backspace on empty text switches back. In text mode Tab and Shift-Tab move the active hint and Enter picks it. In label mode Space turns rapid mode on or off, and Tab and Shift-Tab turn overlapping labels forward and back.",
  params: [
    {
      name: "key",
      type: "enum",
      values: ["slash", "tab", "shift_tab", "enter", "space"],
      value_labels: { slash: "/", tab: "Tab", shift_tab: "Shift-Tab", enter: "Enter", space: "Space" },
      description: { slash: "Switch to typing link text.", tab: "Move to the next match, or turn overlapping labels.", shift_tab: "Move to the previous match, or turn overlapping labels back.", enter: "Pick the active match.", space: "Turn rapid mode on or off, or add a space to the text." },
    },
  ],
  bridge: false,
  runs_in: "content",
  bundle: "hints",
  repeatable: false,
  modes: ["hint"],
});
