// Decides whether an answer from the background may still be drawn. The panel is shown by a key pause or by the `help.whichkey` command.

import type { Mode } from "../../shared/command.ts";
import type { PendingPrefix } from "../key_flow.ts";
import type { WhichKeyPanel } from "../../shared/messages.ts";

// The modes whose keys are a keymap worth listing. The check sits here and not in content.js, which has no spare bytes.
const MODES_WITH_PANEL: readonly string[] = ["normal", "caret", "visual", "visual_line"];

export function create_which_key_session(
  fetch_panel: (mode: Mode, typed: string[]) => Promise<WhichKeyPanel>,
  draw: (panel: WhichKeyPanel) => void,
  hide: () => void,
  // An answer marked `external` was already published by the background, so dropping it must take the panel back down.
  release_external: () => void = () => undefined,
) {
  // Every hide and every manual show moves this on, so an older manual answer finds itself stale.
  let manual_epoch = 0;
  let asking = 0;

  async function show(prefix: PendingPrefix, is_current: () => boolean, drawn?: () => void): Promise<void> {
    if (!MODES_WITH_PANEL.includes(prefix.mode)) return;
    asking++;
    const panel = await fetch_panel(prefix.mode, prefix.typed).finally(() => asking--);
    // The next key may have arrived while the background answered.
    if (is_current() && panel.rows.length > 0) (draw(panel), drawn?.());
    // A later request is still out when asking > 0, and its own answer settles the panel.
    else if (panel.external && asking === 0) release_external();
  }

  return {
    show_prefix_: show,
    // The command lists the first keys of the normal keymap, with no prefix typed.
    show_manual_: (mode: Mode) => {
      const mine = ++manual_epoch;
      return show({ mode, typed: [] }, () => mine === manual_epoch);
    },
    hide: () => {
      manual_epoch++;
      hide();
    },
  };
}
