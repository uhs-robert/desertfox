// The `site_actions` bundle: handlers for commands that site rows bind to keys. Loaded on the first press, so content.js does not carry them.

import type { BundleHostApi } from "../bundle_host.ts";
import { send_key } from "./send_key.ts";
import type { SendKeyArgs } from "./send_key.ts";

type SiteActionsWindow = { desertfox_host?: BundleHostApi; desertfox_site_actions_ready?: true };
const site_actions = window as unknown as SiteActionsWindow;

// A second run would register the handler again for nothing. With no host, content.js has not started here, and the load it asks for later registers the handler.
const host = site_actions.desertfox_host;
if (!site_actions.desertfox_site_actions_ready && host) {
  site_actions.desertfox_site_actions_ready = true;
  host.register_handler_("page.send_key", (args) => send_key(document, args as unknown as SendKeyArgs, (type, init) => new KeyboardEvent(type, init)));
}
