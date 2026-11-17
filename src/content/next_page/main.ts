// The `next_page` bundle: the `page.follow` handler (`]]`, `[[`). Loaded on the first press, so neither content.js nor hints.js carries the detector.

import type { Outcome } from "../../shared/messages.ts";
import { CONFIG_STATUS_STORAGE_KEY } from "../../background/storage_keys.ts";
import { DEFAULT_NEXT_PATTERNS, DEFAULT_PREV_PATTERNS } from "../../shared/default_settings.ts";
import type { PageHostApi } from "../bundle_host.ts";
import { follow_like_a_hint } from "../hints/actions.ts";
import type { Place } from "../hints/actions.ts";
import { arm_leave_watch } from "../page/leave_watch.ts";
import { can_open_elsewhere, find_next_page } from "./follow_links.ts";
import type { FollowDirection } from "./follow_links.ts";
import { find_load_more } from "./load_more.ts";
import { dom_content_watch, wait_for_new_content } from "./load_outcome.ts";
import { move_box_after_load } from "./item_after_load.ts";
import type { ItemCursor } from "../item/pick.ts";

type NextPageWindow = { desertfox_host?: PageHostApi; desertfox_next_page_ready?: true };
type ItemWindow = { desertfox_item_ready?: true };
const next_page = window as unknown as NextPageWindow;

async function read_patterns(direction: FollowDirection): Promise<readonly string[]> {
  const stored = await browser.storage.local.get(CONFIG_STATUS_STORAGE_KEY);
  const chosen = (stored[CONFIG_STATUS_STORAGE_KEY] as { settings?: Record<string, unknown> } | undefined)?.settings?.[`${direction}_patterns`];
  if (Array.isArray(chosen) && chosen.every((entry) => typeof entry === "string")) return chosen;
  return direction === "next" ? DEFAULT_NEXT_PATTERNS : DEFAULT_PREV_PATTERNS;
}

// `from_hints` keeps the router from storing this `open.url`, so `.` repeats `]]`, not the address.
const open_link_ = (url: string, place: Place): Promise<unknown> =>
  browser.runtime.sendMessage({ type: "run", invocations: [{ id: "open.url", args: { url, where: place } }], mode: "normal", from_hints: true });

// Brings an infinite list to its end and a little past, where the page's own scroll watch asks for more.
function scroll_past(last_item: Element): void {
  last_item.scrollIntoView({ block: "end" });
  window.scrollBy(0, innerHeight);
}

// The item bundle loads on the first `page.item` key, so before that no box shows and nothing needs it loaded.
const read_item_cursor = (host: PageHostApi): Promise<ItemCursor | undefined> =>
  new Promise((resolve) => {
    if (!(window as ItemWindow).desertfox_item_ready) return resolve(undefined);
    void host.run_command_("item.cursor", "item", { take: resolve }).then(() => resolve(undefined));
  });

// The same filter as `page.item`: a box the browser hides or that has no size cannot take the focus.
const visible_items = (selector: string): Element[] => Array.from(document.querySelectorAll(selector)).filter((element) => element.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && element.getClientRects().length > 0);

// The load step only changes this page, so it runs for `]]` in place only. A `<link>` has no box to click, so it navigates by its address.
async function follow_page(host: PageHostApi, direction: FollowDirection, place: Place): Promise<Outcome> {
  const found = find_next_page(document, direction, await read_patterns(direction), direction === "next" && place === "here" ? find_load_more : undefined);
  if (found.action === "none") return { ok: false, message: direction === "next" ? "No next page link" : "No previous page link" };
  const target = found.target as HTMLElement;
  if (found.action === "follow") {
    if (place !== "here" && !can_open_elsewhere(target)) return { ok: false, message: "That page link cannot open in another tab" };
    // The user acts now, so the address change the follow makes is a move for the jump list.
    arm_leave_watch(host).quiet_(false);
    if (target.localName === "link") {
      if (place === "here") window.location.assign((target as HTMLLinkElement).href);
      else await open_link_((target as HTMLLinkElement).href, place);
    } else await follow_like_a_hint(place, target, open_link_);
    return { ok: true };
  }
  const loaded = wait_for_new_content(dom_content_watch(document));
  void move_box_after_load(await read_item_cursor(host), { items_: visible_items, watch_: dom_content_watch(document), cursor_: () => read_item_cursor(host), in_normal_mode_: () => host.get_mode() === "normal" });
  if (found.action === "click") void follow_like_a_hint("here", target, open_link_);
  else scroll_past(target);
  // The answer does not wait for the load, so the keys typed after `]]` run at once.
  void loaded.then((arrived) => arrived || host.show_toast_("Nothing loaded"));
  return { ok: true };
}

// A second run would register the handler again for nothing. With no host, content.js has not started here, and the load it asks for later registers the handler.
const host = next_page.desertfox_host;
if (!next_page.desertfox_next_page_ready && host) {
  next_page.desertfox_next_page_ready = true;
  host.register_handler_("page.follow", (args) => follow_page(host, args.direction as FollowDirection, args.where as Place));
}
