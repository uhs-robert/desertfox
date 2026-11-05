// Layers of the surfaces the content script puts on a page, bottom to top. The numbers are the z-index of the command
// line, which is not in the top layer. The other surfaces are top-layer popovers, where z-index has no effect: they stack
// in the order shown, and `mount_surface` shows them again in this order. Numbers only, so content.js stays small.

const BROWSER_MAX_Z_INDEX = 2147483647;

export const LAYERS = {
  hints: BROWSER_MAX_Z_INDEX - 4,
  mode_badge: BROWSER_MAX_Z_INDEX - 3,
  toast: BROWSER_MAX_Z_INDEX - 2,
  which_key: BROWSER_MAX_Z_INDEX - 1,
  command_line: BROWSER_MAX_Z_INDEX,
} as const;
