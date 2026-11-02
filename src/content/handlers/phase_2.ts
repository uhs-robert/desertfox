import type { ContentHandler } from "./types.ts";

// The content commands of phase 2 register now so keys and help list them. Running one refuses.
const refusing = (reason: string): ContentHandler => ({
  run: () => {
    throw new Error(reason);
  },
});

export const NEEDS_HINTS = "needs hints (phase 2)";
export const NEEDS_COMMAND_LINE = "needs the command line (phase 2)";

export const needs_hints = refusing(NEEDS_HINTS);
export const needs_command_line = refusing(NEEDS_COMMAND_LINE);
