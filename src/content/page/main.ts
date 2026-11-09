// The `page` bundle: registers `scroll.align`, `copy.url` and `page.focus_input`, which are rare enough to stay out of content.js.

import type { BundleHostApi } from "../bundle_host.ts";
import type { AlignPosition } from "../align_target.ts";
import { align_focus } from "../handlers/align.ts";
import { copy_page_url } from "../handlers/copy.ts";
import type { CopyFormat } from "../handlers/copy.ts";
import { focus_first_input } from "../handlers/focus_input.ts";

type PageWindow = { desertfox_host: BundleHostApi; desertfox_page_ready?: true };
const page = window as unknown as PageWindow;

// A second run would register the handlers again for nothing.
if (!page.desertfox_page_ready) {
  page.desertfox_page_ready = true;
  const host = page.desertfox_host;
  host.register_handler("scroll.align", (args) => align_focus(args.position as AlignPosition, host.last_blurred()));
  host.register_handler("copy.url", (args) => copy_page_url(args.format as CopyFormat, host.show_toast));
  host.register_handler("page.focus_input", () => focus_first_input());
}
