// Decides whether an answer from the background may still be drawn. The panel is shown by a key pause or by the `help.whichkey` command.

import type { Mode } from "../../shared/command.ts";
import type { PendingPrefix } from "../key_flow.ts";
import type { WhichKeyPanel } from "../../shared/messages.ts";

// The modes whose keys are a keymap worth listing. The check sits here and not in content.js, which has no spare bytes.
// Insert and hint mode show the panel only on request: their half-typed sequences would pop it up after every typed letter.
const MODES_WITH_PAUSE_PANEL: readonly string[] = ["normal", "caret", "visual", "visual_line", "media"];
const MODES_WITH_PANEL: readonly string[] = [...MODES_WITH_PAUSE_PANEL, "insert", "hint"];

export function create_which_key_session(
  fetch_panel: (mode: Mode, typed: string[]) => Promise<WhichKeyPanel>,
  draw: (panel: WhichKeyPanel) => void,
  hide: () => void,
) {
  // Every hide and every manual show moves this on, so an older manual answer finds itself stale.
  let manual_epoch = 0;

  async function show(prefix: PendingPrefix, is_current: () => boolean, drawn?: () => void, modes = MODES_WITH_PAUSE_PANEL): Promise<void> {
    if (!modes.includes(prefix.mode)) return;
    const panel = await fetch_panel(prefix.mode, prefix.typed_);
    // The next key may have arrived while the background answered.
    if (is_current() && panel.rows.length > 0) (draw(panel), drawn?.());
  }

  return {
    show_prefix_: (prefix: PendingPrefix, is_current: () => boolean, drawn?: () => void) => show(prefix, is_current, drawn),
    // The command lists the first keys of the normal keymap, with no prefix typed.
    show_manual_: (mode: Mode) => {
      const mine = ++manual_epoch;
      return show({ mode, typed_: [] }, () => mine === manual_epoch, undefined, MODES_WITH_PANEL);
    },
    hide: () => {
      manual_epoch++;
      hide();
    },
  };
}
