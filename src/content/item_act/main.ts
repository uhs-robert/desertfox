// The `item_act` bundle: `page.item_action`, which acts on the current item of item mode (Space toggles its checkbox, Enter opens its link or clicks the element focused inside it) and `page.item_focus` (Tab and Shift-Tab step the focus through the item). Loaded on the first press.

import { RuntimeRefusal } from "../../shared/command.ts";
import type { PageHostApi } from "../bundle_host.ts";
import { click_like_a_hint } from "../hints/actions.ts";
import { checkbox_in } from "./checkbox.ts";
import { focusables_in, next_focus } from "./focus.ts";

type ItemActWindow = { desertfox_host?: PageHostApi; desertfox_item_act_ready?: true };
const item_act = window as unknown as ItemActWindow;

// A second run would register the handler again for nothing. With no host, content.js has not started here, and the load it asks for later registers the handler.
const host = item_act.desertfox_host;
if (!item_act.desertfox_item_act_ready && host) {
  item_act.desertfox_item_act_ready = true;
  // The element `page.item_focus` focused last. Enter clicks it only while it still has the focus, so a focus from a click or Space leaves Enter on the link.
  let tabbed: Element | null = null;
  const current_item = async () => {
    let current: { item?: Element | undefined; link?: Element | undefined } = {};
    await host.run_command_("item.current", "item", { take: (item?: Element, link?: Element) => (current = { item, link }) });
    if (!current.item) throw new RuntimeRefusal("No current item");
    return current as { item: Element; link?: Element | undefined };
  };
  const checked = (box: Element) => (box.matches("input") ? (box as HTMLInputElement).checked : box.getAttribute("aria-checked") === "true");
  // The list as item mode reads it now, with the keys of its items and the places of the range and its anchor, or nothing outside visual item mode. It is read again before each click, so a list the page redraws, or a click that removes a row, never gives a stale node or a shifted place.
  type Listed = [items?: Element[], keys?: string[], from?: number, to?: number, anchor?: number];
  const read_list = async () => {
    let list: Listed = [];
    await host.run_command_("item.range", "item", { take: (...taken: Listed) => (list = taken) });
    return list;
  };
  host.register_handler_("page.item_action", async (args) => {
    if (args.action === "toggle_range") {
      const [items, keys = [], from = 0, to = 0, anchor = 0] = await read_list();
      const anchor_box = items?.[anchor] && checkbox_in(items[anchor]);
      if (!anchor_box) throw new RuntimeRefusal("No checkbox in the anchor item");
      const target = !checked(anchor_box);
      let changed = 0;
      for (const key of keys.slice(from, to + 1)) {
        const [now = [], now_keys = []] = await read_list();
        const item = now[now_keys.indexOf(key)];
        const box = item && checkbox_in(item);
        if (box && checked(box) !== target) (click_like_a_hint(box as HTMLElement), changed++);
      }
      return host.show_toast_(`${changed} changed`);
    }
    const current = await current_item();
    const toggle = args.action === "toggle";
    const clicked = toggle ? checkbox_in(current.item, args.target as string) : (document.activeElement === tabbed && current.item.contains(tabbed) ? tabbed : current.link);
    if (!clicked) throw new RuntimeRefusal(toggle ? "No checkbox in this item" : "This item has no link");
    click_like_a_hint(clicked as HTMLElement);
  });
  host.register_handler_("page.item_focus", async (args) => {
    const target = next_focus((await current_item()).item, document.activeElement, args.direction as "next" | "prev", () => focusables_in(document.documentElement, host.is_editable_), host.is_editable_);
    if (!target) throw new RuntimeRefusal("Nothing to focus");
    (tabbed = target as HTMLElement).focus();
  });
}
