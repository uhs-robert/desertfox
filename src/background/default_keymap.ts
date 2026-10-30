import type { KeymapConfig } from "../shared/keymap.ts";

// Small and vim-standard. The owner's own bindings live in the dotfiles, not here.
// `o O t f F : g?` are bound now and refuse until the phase 2 command line and hints exist.
export const DEFAULT_KEYMAP: KeymapConfig = {
  normal: {
    h: { id: "scroll.pixels", args: { dx: -50 } },
    l: { id: "scroll.pixels", args: { dx: 50 } },
    j: { id: "scroll.lines", args: { count: 10 } },
    k: { id: "scroll.lines", args: { count: -10 } },
    gg: { id: "scroll.to", args: { percent: 0 } },
    G: { id: "scroll.to", args: { percent: 100 } },
    "<C-d>": { id: "scroll.pages", args: { fraction: 0.5 } },
    "<C-u>": { id: "scroll.pages", args: { fraction: -0.5 } },
    "<C-f>": { id: "scroll.pages", args: { fraction: 1 } },
    "<C-b>": { id: "scroll.pages", args: { fraction: -1 } },

    H: { id: "page.back" },
    L: { id: "page.forward" },
    r: { id: "page.reload" },
    R: { id: "page.reload", args: { hard: true } },

    J: { id: "tab.next" },
    K: { id: "tab.prev" },
    gt: { id: "tab.goto" },
    gT: { id: "tab.prev" },
    x: { id: "tab.close" },
    dd: { id: "tab.close" },
    u: { id: "tab.undo_close" },

    yy: { id: "copy.url", args: { format: "plain" } },
    gu: { id: "url.parent" },
    gU: { id: "url.root" },
    gi: { id: "page.focus_input" },

    zi: { id: "zoom.by", args: { delta: 0.1 } },
    zo: { id: "zoom.by", args: { delta: -0.1 } },
    zz: { id: "zoom.set", args: { level: 1 } },

    "<S-Escape>": { id: "mode.set", args: { mode: "ignore" } },
    "<Escape>": { id: "mode.escape" },
    "<C-v>": { id: "mode.pass_next" },
    "<F1>": { id: "help.open" },

    o: { id: "open.url", args: { where: "current" }, prompt: { param: "url" } },
    O: { id: "open.url", args: { where: "new_tab" }, prompt: { param: "url" } },
    t: { id: "open.url", args: { where: "new_tab" }, prompt: { param: "url" } },
    f: { id: "hint.run", args: { action: "open" } },
    F: { id: "hint.run", args: { action: "background" } },
    ":": { id: "cmdline.open" },
    "g?": { id: "help.whichkey" },
  },
  insert: {
    "<Escape>": { id: "mode.escape" },
  },
  ignore: {
    "<S-Escape>": { id: "mode.set", args: { mode: "normal" } },
  },
  browser: {
    "<A-j>": { id: "tab.next" },
    "<A-k>": { id: "tab.prev" },
  },
};
