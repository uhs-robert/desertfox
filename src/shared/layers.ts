// Stacking order of the surfaces the content script puts on a page, bottom to top. The command line takes the browser
// maximum for z-index, and each layer below it is one less. Numbers only, so content.js stays small.

const BROWSER_MAX_Z_INDEX = 2147483647;

export const LAYERS = {
  hints: BROWSER_MAX_Z_INDEX - 4,
  mode_badge: BROWSER_MAX_Z_INDEX - 3,
  toast: BROWSER_MAX_Z_INDEX - 2,
  which_key: BROWSER_MAX_Z_INDEX - 1,
  command_line: BROWSER_MAX_Z_INDEX,
} as const;
