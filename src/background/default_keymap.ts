import type { KeymapConfig } from "../shared/keymap.ts";

// Placeholder until wave 4 ships the real default keymap.
export const DEFAULT_KEYMAP: KeymapConfig = {
  normal: {
    ZR: { id: "config.reload" },
  },
  browser: {
    "<A-S-r>": { id: "config.reload" },
  },
};
