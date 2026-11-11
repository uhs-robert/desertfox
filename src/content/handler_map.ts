// The only link from command ids to code in the content bundle. It imports handler
// files, never the registry or the command definitions.

import { mode_escape, mode_pass_next, mode_set, mode_site } from "./handlers/mode.ts";
import { page_blur } from "./handlers/page.ts";
import { scroll_lines, scroll_pages, scroll_pixels, scroll_to } from "./handlers/scroll.ts";
import { stop_page } from "./handlers/stop.ts";
import type { ContentHandler } from "./handlers/types.ts";

export const content_handlers: Record<string, ContentHandler> = {
  "scroll.lines": scroll_lines,
  "scroll.pixels": scroll_pixels,
  "scroll.pages": scroll_pages,
  "scroll.to": scroll_to,
  "mode.set": mode_set,
  "mode.escape": mode_escape,
  "mode.pass_next": mode_pass_next,
  "mode.site": mode_site,
  "page.blur": page_blur,
  "page.stop": stop_page,
};
