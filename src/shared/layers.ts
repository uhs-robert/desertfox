// Layers of the surfaces the content script puts on a page, bottom to top. Every surface, the command line included, is a
// top-layer popover, where z-index has no effect: they stack in the order shown, and `mount_surface` shows them again in
// this order. The numbers double as the z-index each host carries as a fallback. Constants only, so content.js stays small.

// Marks a surface host with its layer, so a bundle finds the hosts of the others.
export const LAYER_ATTRIBUTE = "data-desertfox-layer";
// Sent to a host that `mount_surface` showed again, which hid it and so took the focus out of it.
export const RESTACKED_EVENT = "desertfox-restacked";

const BROWSER_MAX_Z_INDEX = 2147483647;

export const LAYERS = {
  hints: BROWSER_MAX_Z_INDEX - 4,
  mode_badge: BROWSER_MAX_Z_INDEX - 3,
  toast: BROWSER_MAX_Z_INDEX - 2,
  which_key: BROWSER_MAX_Z_INDEX - 1,
  command_line: BROWSER_MAX_Z_INDEX,
} as const;
