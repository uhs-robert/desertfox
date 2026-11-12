// The `page` bundle: registers `scroll.align`, `copy.url`, `page.focus_input`, `mark.add`, `mark.jump` and `page.jump`, which are rare enough to stay out of content.js. It also answers the background's `get_selection`.

import type { BundleHostApi } from "../bundle_host.ts";
import type { AlignPosition } from "../align_target.ts";
import { align_focus } from "../handlers/align.ts";
import { focus_first_input } from "../handlers/focus_input.ts";
import { mark_text_entry } from "../text/entry.ts";
import { copy_page_url } from "../handlers/copy.ts";
import type { CopyFormat } from "../handlers/copy.ts";
import { selected_text } from "./selection.ts";
import { RuntimeRefusal } from "../../shared/command.ts";
import type { BackgroundToContent, JumpStep, MarkAnswer, MarkRequest } from "../../shared/messages.ts";

type PageWindow = { desertfox_host?: BundleHostApi; desertfox_page_ready?: true };
const page = window as unknown as PageWindow;

// A set stores the scroll offset now. A jump asks the background for the stored one, which keeps the offset now as the previous position, then scrolls instantly so a smooth scroll in flight ends.
// A step of the jump list asks the same way and gets the entry the cursor moved to, or nothing to scroll to when the background went to another tab.
async function ask_at_scroll(host: BundleHostApi, message: { type: MarkRequest["type"]; key: string } | Pick<JumpStep, "type" | "step" | "arrival">) {
  const box = host.scroll_box_();
  const answer = (await browser.runtime.sendMessage({ ...message, url: location.href, x: box.scrollLeft, y: box.scrollTop })) as MarkAnswer;
  if (!answer.ok) throw new RuntimeRefusal(answer.message);
  if (message.type !== "mark_set" && answer.x !== undefined) box.scrollTo({ left: answer.x, top: answer.y, behavior: "instant" });
}

const offset_of = (host: BundleHostApi) => {
  const box = host.scroll_box_();
  return { x: box.scrollLeft, y: box.scrollTop };
};

// A second run would register the handlers again for nothing.
// With no host, content.js has not started in this frame. The run leaves the flag unset, so the load that content.js asks for later registers the handlers.
const host = page.desertfox_host;
if (!page.desertfox_page_ready && host) {
  page.desertfox_page_ready = true;
  host.register_handler_("scroll.align", (args) => align_focus(args.position as AlignPosition, host.last_blurred_()));
  host.register_handler_("page.focus_input", () => {
    focus_first_input();
    mark_text_entry({ id: "page.focus_input" });
  });
  host.register_handler_("mark.add", (args) => ask_at_scroll(host, { type: "mark_set", key: args.key as string }));
  host.register_handler_("mark.jump", (args) => ask_at_scroll(host, { type: "mark_jump", key: args.key as string }));
  host.register_handler_("page.jump", (args) => ask_at_scroll(host, { type: "jump_step", step: (args.direction === "older" ? -1 : 1) * (args.steps as number), ...(typeof args.arrival === "number" && { arrival: args.arrival }) }));
  host.register_handler_("copy.url", (args) => copy_page_url(args.format as CopyFormat, args.register as string | undefined, host.show_toast_));
  // Returns nothing for every other message, so the listener in content.js answers those.
  browser.runtime.onMessage.addListener((message: BackgroundToContent) => {
    if (message.type === "get_jump_offset") return Promise.resolve({ ...offset_of(host), url: location.href });
    return message.type === "get_selection" ? Promise.resolve(selected_text()) : undefined;
  });
  // The background records the place if the tab goes to another address. Only the top frame's report counts.
  addEventListener("pagehide", () => void browser.runtime.sendMessage({ type: "jump_leave", ...offset_of(host) }));
}
