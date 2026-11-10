import type { ContentHandler } from "./types.ts";

export const stop_page: ContentHandler = {
  run: () => window.stop(),
};
