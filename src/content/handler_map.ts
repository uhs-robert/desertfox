// The only link from command ids to code in the content bundle. It imports handler
// files, never the registry or the command definitions.

import { mode_escape, mode_pass_next, mode_set } from "./handlers/mode.ts";
import { copy_url } from "./handlers/copy.ts";
import { page_blur, page_focus_input } from "./handlers/page.ts";
import { scroll_align } from "./handlers/align.ts";
import { scroll_lines, scroll_pages, scroll_pixels, scroll_to } from "./handlers/scroll.ts";
import { caret_move, cmdline_clear, cmdline_help, cmdline_history, cmdline_next_completion, cmdline_open, cmdline_prev_completion, cmdline_submit, find_next, find_open, find_prev, help_whichkey, hint_run, visual_act } from "./handlers/lazy_bundle.ts";
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
  "hint.run": hint_run,
  "cmdline.open": cmdline_open,
  "cmdline.next_completion": cmdline_next_completion,
  "cmdline.prev_completion": cmdline_prev_completion,
  "cmdline.submit": cmdline_submit,
  "cmdline.history": cmdline_history,
  "cmdline.clear": cmdline_clear,
  "cmdline.help": cmdline_help,
  "caret.move": caret_move,
  "visual.act": visual_act,
  "find.open": find_open,
  "find.next": find_next,
  "find.prev": find_prev,
  "help.whichkey": help_whichkey,
};
