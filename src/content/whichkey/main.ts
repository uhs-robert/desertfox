// The `whichkey` bundle: registers handlers. With a prefix it shows the keys that can follow, without one it hides the panel.

import type { BundleHostApi } from "../bundle_host.ts";
import type { PendingPrefix } from "../key_flow.ts";
import type { ListKeys, WhichKeyPanel } from "../../shared/messages.ts";
import { MEDIA_PANEL_HANDLER, media_panel_admitted } from "./media_panel.ts";
import { hide_panel, show_panel } from "./panel.ts";
import { create_which_key_session } from "./session.ts";

type WhichKeyWindow = { desertfox_host: BundleHostApi; desertfox_whichkey_ready?: true };
const page = window as unknown as WhichKeyWindow;

type ShowArgs = { prefix?: PendingPrefix; is_current_: () => boolean; drawn_: () => void };

const session = create_which_key_session(
  (mode, typed) => browser.runtime.sendMessage({ type: "list_keys", mode, prefix: typed } satisfies ListKeys) as Promise<WhichKeyPanel>,
  show_panel,
  hide_panel,
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
  // Not a command: only the background asks for it, so there is no argument to check.
  page.desertfox_host.register_handler_(MEDIA_PANEL_HANDLER, () => {
    const mode = page.desertfox_host.get_mode();
    if (media_panel_admitted(mode, !!document.fullscreenElement)) void session.show_manual_(mode).catch(ignore_failure);
  });
}
