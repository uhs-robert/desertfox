// The only link from command ids to code in the content bundle. It imports handler
// files, never the registry or the command definitions.

import { mode_escape, mode_pass_next, mode_set } from "./handlers/mode.ts";
import { copy_url } from "./handlers/copy.ts";
import { page_blur, page_focus_input } from "./handlers/page.ts";
import { scroll_align } from "./handlers/align.ts";
import { scroll_lines, scroll_pages, scroll_pixels, scroll_to } from "./handlers/scroll.ts";
import { needs_command_line, needs_hints } from "./handlers/phase_2.ts";
import { stop_page } from "./handlers/stop.ts";
import type { ContentHandler } from "./handlers/types.ts";

export const content_handlers: Record<string, ContentHandler> = {
  "scroll.lines": scroll_lines,
  "scroll.pixels": scroll_pixels,
  "scroll.pages": scroll_pages,
  "scroll.to": scroll_to,
  "scroll.align": scroll_align,
  "mode.set": mode_set,
  "mode.escape": mode_escape,
  "mode.pass_next": mode_pass_next,
  "page.focus_input": page_focus_input,
  "page.blur": page_blur,
  "page.stop": stop_page,
  "copy.url": copy_url,
  "hint.run": needs_hints,
  "cmdline.open": needs_command_line,
  "cmdline.next_completion": needs_command_line,
  "cmdline.prev_completion": needs_command_line,
  "help.whichkey": needs_command_line,
};
