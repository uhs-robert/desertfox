// The site mode in force on this page, or undefined. It lays a row's own binds over normal mode and is not a `Mode`. Plain state like `page_mode`: main.ts wires the listener that swaps the keymap.

export const site_mode: { name_: string | undefined; on_change_: () => void; set_: (next?: string) => void } = {
  name_: undefined,
  on_change_: () => {},
  set_: (next) => {
    if (next === site_mode.name_) return;
    site_mode.name_ = next;
    site_mode.on_change_();
  },
};
