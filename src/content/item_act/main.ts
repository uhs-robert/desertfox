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
  const checked = (box: Element) => !!(box as HTMLInputElement).checked || box.getAttribute("aria-checked") === "true";
  // The range is read again before each click, so a list the page redraws on a click still gives the item at that place.
  const range_at = async (index: number) => {
    let found: { items?: Element[] | undefined; anchor?: Element | undefined } = {};
    await host.run_command_("item.range", "item", { take: (items?: Element[], anchor?: Element) => (found = { items, anchor }) });
    return { item: found.items?.[index], anchor: found.anchor, size: found.items?.length ?? 0 };
  };
  host.register_handler_("page.item_action", async (args) => {
    if (args.action === "toggle_range") {
      const start = await range_at(0);
      const anchor_box = start.anchor && checkbox_in(start.anchor);
      if (!anchor_box) throw new RuntimeRefusal(start.size ? "No checkbox in the first item" : "No selection");
      const target = !checked(anchor_box);
      let changed = 0;
      for (let index = 0, range = start; range.item; range = await range_at(++index)) {
        const box = checkbox_in(range.item);
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
