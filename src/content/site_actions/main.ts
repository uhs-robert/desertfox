// The `site_actions` bundle: handlers for commands that site rows bind to keys. Loaded on the first press, so content.js does not carry them.

import type { PageHostApi } from "../bundle_host.ts";
import { queued_in_page, send_key_queued } from "./send_key.ts";
import { arrow_queued } from "./arrow.ts";
import type { ArrowArgs } from "./arrow.ts";
import { clipboard_action, paste_through_clipboard_api } from "./clipboard.ts";

type SiteActionsWindow = { desertfox_host?: PageHostApi; desertfox_site_actions_ready?: true };
const site_actions = window as unknown as SiteActionsWindow;

// A second run would register the handler again for nothing. With no host, content.js has not started here, and the load it asks for later registers the handler.
const host = site_actions.desertfox_host;
if (!site_actions.desertfox_site_actions_ready && host) {
  site_actions.desertfox_site_actions_ready = true;
  host.register_handler_("page.send_key", (args) => send_key_queued(document, args, (type, init) => new KeyboardEvent(type, init)));
  host.register_handler_("page.arrow", (args) =>
    arrow_queued({ focused: host.focused_, scroll_by: host.scroll_by_, make_event: (type, init) => new KeyboardEvent(type, init) }, args as unknown as ArrowArgs),
  );
  host.register_handler_("page.clipboard", (args) => queued_in_page(() => clipboard_action(document, args, paste_through_clipboard_api)));
}
