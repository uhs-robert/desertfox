// Takes the frame back to the mode a one-shot normal command started in, once a mode that command opened ends in normal mode (`v`, `f` or `:` typed after the prefix in insert mode). A command that opens no mode, or one that only leaves its mode (a blur), leaves the frame where it is.

import type { Mode } from "../../shared/command.ts";
import type { PageHostApi } from "../bundle_host.ts";

export function create_once_return(host: Pick<PageHostApi, "get_mode" | "set_mode_" | "focused_" | "is_editable_">) {
  let from: [mode: Mode, focused: Element | null] | undefined;
  let opened = false;

  const mode_changed = (mode: Mode) => {
    if (!from) return;
    if (mode !== "normal" && mode !== from[0]) return void (opened = true);
    const [back, focused] = from;
    from = undefined;
    if (opened && mode === "normal") setTimeout(go_back, 0, back, focused);
  };

  // A task later, because the Escape that ends a mode blurs the focused element after the mode change.
  const go_back = (back: Mode, focused: Element | null) => {
    // A field the command focused keeps the focus.
    if (host.is_editable_(host.focused_())) return;
    // The field takes insert mode back as it takes the focus. A removed field takes no focus, so the frame stays in normal mode.
    if (back !== "insert") host.set_mode_(back);
    else if (focused?.isConnected) (focused as HTMLElement).focus();
  };

  return {
    // `ended` settles when the command has run. The command may have changed the mode before this bundle loaded, so the mode now counts as its first change.
    start_: (mode: Mode, focused: Element | null, ended: Promise<unknown>) => {
      if (mode === "normal") return;
      const mine = (from = [mode, focused]);
      opened = false;
      if (host.get_mode() !== mode) mode_changed(host.get_mode());
      void ended.then(() => from === mine && !opened && (from = undefined));
    },
    mode_changed_: mode_changed,
  };
}
