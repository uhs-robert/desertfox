// The `which-key` bundle: registers handlers. With a prefix it shows the keys that can follow, without one it hides the panel.

import type { BundleHostApi } from "../bundle_host.ts";
import type { PendingPrefix } from "../key_flow.ts";
import type { ListKeys, WhichKeyPanel } from "../../shared/messages.ts";
import { hide_panel, show_panel } from "./panel.ts";
import { create_which_key_session } from "./session.ts";

type WhichKeyWindow = { oasisfox_host: BundleHostApi; oasisfox_whichkey_ready?: true };
const page = window as unknown as WhichKeyWindow;

type ShowArgs = { prefix?: PendingPrefix; is_current: () => boolean };

const session = create_which_key_session(
  (mode, typed) => browser.runtime.sendMessage({ type: "list_keys", mode, prefix: typed } satisfies ListKeys) as Promise<WhichKeyPanel>,
  show_panel,
  hide_panel,
);
const ignore_failure = () => undefined;

// A second run would register a second copy of the handler.
if (!page.oasisfox_whichkey_ready) {
  page.oasisfox_whichkey_ready = true;
  page.oasisfox_host.register_handler("whichkey", (args) => {
    const { prefix, is_current } = args as ShowArgs;
    if (!prefix) return session.hide();
    void session.show_prefix(prefix, is_current).catch(ignore_failure);
  });
  page.oasisfox_host.register_handler("help.whichkey", () => void session.show_manual(page.oasisfox_host.get_mode()).catch(ignore_failure));
}
