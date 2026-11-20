// The `item_act` bundle: `page.item_action`, which acts on the current item of item mode (Space toggles its checkbox, Enter opens its link). Loaded on the first press.

import { RuntimeRefusal } from "../../shared/command.ts";
import type { PageHostApi } from "../bundle_host.ts";
import { click_like_a_hint } from "../hints/actions.ts";
import { checkbox_in } from "./checkbox.ts";

type ItemActWindow = { desertfox_host?: PageHostApi; desertfox_item_act_ready?: true };
const item_act = window as unknown as ItemActWindow;

// A second run would register the handler again for nothing. With no host, content.js has not started here, and the load it asks for later registers the handler.
const host = item_act.desertfox_host;
if (!item_act.desertfox_item_act_ready && host) {
  item_act.desertfox_item_act_ready = true;
  host.register_handler_("page.item_action", async (args) => {
    let current: { item?: Element | undefined; link?: Element | undefined } = {};
    await host.run_command_("item.current", "item", { take: (item?: Element, link?: Element) => (current = { item, link }) });
    if (!current.item) throw new RuntimeRefusal("No current item");
    const clicked = args.action === "toggle" ? checkbox_in(current.item, args.target as string) : current.link;
    if (!clicked) throw new RuntimeRefusal(args.action === "toggle" ? "No checkbox in this item" : "This item has no link");
    click_like_a_hint(clicked as HTMLElement);
  });
}
