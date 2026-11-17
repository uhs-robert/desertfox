// The `item` bundle: the handler of `page.item`, which site rows bind to j and k on result pages. Loaded on the first press.

import type { PageHostApi } from "../bundle_host.ts";
import { move_item } from "./pick.ts";
import type { ItemArgs } from "./pick.ts";
import { create_item_overlay } from "./overlay.ts";

type ItemWindow = { desertfox_host?: PageHostApi; desertfox_item_ready?: true };
const item_window = window as unknown as ItemWindow;

// A second run would register the handler again for nothing. With no host, content.js has not started here, and the load it asks for later registers the handler.
const host = item_window.desertfox_host;
if (!item_window.desertfox_item_ready && host) {
  item_window.desertfox_item_ready = true;
  const overlay = create_item_overlay(() => host.get_mode() === "normal");
  host.register_handler_("page.item", (args) => move_item({ doc: document, view: window, focused: host.focused_, toast: host.show_toast_, scroll_by: host.scroll_by_, highlight: overlay.show }, args as unknown as ItemArgs));
}
