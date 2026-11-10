// The `page` bundle: registers `scroll.align`, `copy.url`, `page.focus_input`, `mark.add` and `mark.jump`, which are rare enough to stay out of content.js.

import type { BundleHostApi } from "../bundle_host.ts";
import type { AlignPosition } from "../align_target.ts";
import { align_focus } from "../handlers/align.ts";
import { focus_first_input } from "../handlers/focus_input.ts";
import { mark_text_entry } from "../text/entry.ts";
import { copy_page_url } from "../handlers/copy.ts";
import type { CopyFormat } from "../handlers/copy.ts";
import { RuntimeRefusal } from "../../shared/command.ts";
import type { MarkAnswer, MarkRequest } from "../../shared/messages.ts";

type PageWindow = { desertfox_host: BundleHostApi; desertfox_page_ready?: true };
const page = window as unknown as PageWindow;

// A set stores the scroll offset now. A jump asks the background for the stored one, which keeps the offset now as the previous position, then scrolls instantly so a smooth scroll in flight ends.
async function mark_at_scroll(host: BundleHostApi, type: MarkRequest["type"], key: unknown) {
  const box = host.scroll_box_();
  const answer = (await browser.runtime.sendMessage({ type, key, url: location.href, x: box.scrollLeft, y: box.scrollTop } as MarkRequest)) as MarkAnswer;
  if (!answer.ok) throw new RuntimeRefusal(answer.message);
  if (type === "mark_jump" && answer.x !== undefined) box.scrollTo({ left: answer.x, top: answer.y, behavior: "instant" });
}

// A second run would register the handlers again for nothing.
if (!page.desertfox_page_ready) {
  page.desertfox_page_ready = true;
  const host = page.desertfox_host;
  host.register_handler_("scroll.align", (args) => align_focus(args.position as AlignPosition, host.last_blurred_()));
  host.register_handler_("page.focus_input", () => {
    focus_first_input();
    mark_text_entry({ id: "page.focus_input" });
  });
  host.register_handler_("mark.add", (args) => mark_at_scroll(host, "mark_set", args.key));
  host.register_handler_("mark.jump", (args) => mark_at_scroll(host, "mark_jump", args.key));
  host.register_handler_("copy.url", (args) => copy_page_url(args.format as CopyFormat, args.register as string | undefined, host.show_toast_));
}
