import type { PageSiteMode } from "../shared/index.ts";

// The site mode in force on this page, or undefined. It lays a row's own binds over normal mode and is not a `Mode`. Plain state like `page_mode`: main.ts wires the listener that swaps the keymap.

// `modes_` is what the page reply defines. A name it lacks changes nothing, so a typo cannot end the running mode.
export const site_mode: { name_: string | undefined; modes_: Record<string, PageSiteMode> | undefined; on_change_: () => void; set_: (next?: string) => void } = {
  name_: undefined,
  modes_: undefined,
  on_change_: () => {},
  set_: (next) => {
    if (next === site_mode.name_ || (next !== undefined && !site_mode.modes_?.[next])) return;
    site_mode.name_ = next;
    site_mode.on_change_();
  },
};
