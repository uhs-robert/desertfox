// The `whichkey` bundle: registers handlers. With a prefix it shows the keys that can follow, without one it hides the panel.

import type { BundleHostApi } from "../bundle_host.ts";
import type { PendingPrefix } from "../key_flow.ts";
import type { ListKeys, WhichKeyHidden, WhichKeyPanel } from "../../shared/messages.ts";
import { hide_panel, show_panel } from "./panel.ts";
import { create_which_key_session } from "./session.ts";

type WhichKeyWindow = { desertfox_host: BundleHostApi; desertfox_whichkey_ready?: true };
const page = window as unknown as WhichKeyWindow;

type ShowArgs = { prefix?: PendingPrefix; is_current_: () => boolean; drawn_: () => void };

// True while the display host shows a panel for this page. The page draws nothing then, and tells the background once when the panel goes.
let external_up = false;
function show_external_or_panel(panel: WhichKeyPanel): void {
  external_up = panel.external === true;
  if (!external_up) show_panel(panel);
}
function tell_background_panel_gone(): void {
  external_up = false;
  void browser.runtime.sendMessage({ type: "whichkey_hidden" } satisfies WhichKeyHidden).catch(() => undefined);
}
function hide_panel_and_tell(): void {
  hide_panel();
  if (external_up) tell_background_panel_gone();
}

const session = create_which_key_session(
  (mode, typed) => browser.runtime.sendMessage({ type: "list_keys", mode, prefix: typed } satisfies ListKeys) as Promise<WhichKeyPanel>,
  show_external_or_panel,
  hide_panel_and_tell,
  tell_background_panel_gone,
);
const ignore_failure = () => undefined;

// A second run would register a second copy of the handler.
if (!page.desertfox_whichkey_ready) {
  page.desertfox_whichkey_ready = true;
  page.desertfox_host.register_handler_("whichkey", (args) => {
    const { prefix, is_current_, drawn_ } = args as ShowArgs;
    if (!prefix) return session.hide();
    void session.show_prefix_(prefix, is_current_, drawn_).catch(ignore_failure);
  });
  page.desertfox_host.register_handler_("help.whichkey", () => void session.show_manual_(page.desertfox_host.get_mode()).catch(ignore_failure));
}
