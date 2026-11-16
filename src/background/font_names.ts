// The font names the font settings suggest: the host's installed fonts where it is set up, merged with a canvas probe of the built-in candidates. The merge is cached in storage, so the command line opens with no probe and no host call.

import { FONT_CANDIDATES, merge_font_names, probe_fonts } from "../shared/font_candidates.ts";
import type { MeasureWidth } from "../shared/font_candidates.ts";
import { FONT_NAMES_STORAGE_KEY } from "./storage_keys.ts";

export type FontNamesDeps = {
  storage: Pick<typeof browser.storage.local, "get" | "set">;
  // The host's installed families, or undefined when it did not answer (not installed, no permission, too old, failed).
  host_fonts: () => Promise<string[] | undefined>;
  // Undefined where no canvas exists.
  measure: () => MeasureWidth | undefined;
};

type Cache = { host: string[]; names: string[] };

const is_names = (value: unknown): value is string[] => Array.isArray(value) && value.every((name) => typeof name === "string");

export function create_font_names(deps: FontNamesDeps) {
  async function read_cache(): Promise<Cache | undefined> {
    const stored: unknown = (await deps.storage.get(FONT_NAMES_STORAGE_KEY))[FONT_NAMES_STORAGE_KEY];
    const cache = stored as Partial<Cache> | undefined;
    return is_names(cache?.host) && is_names(cache?.names) ? { host: cache.host, names: cache.names } : undefined;
  }

  async function write(host: string[]): Promise<string[]> {
    const measure = deps.measure();
    const names = merge_font_names(host, measure ? probe_fonts(FONT_CANDIDATES, measure) : []);
    await deps.storage.set({ [FONT_NAMES_STORAGE_KEY]: { host, names } satisfies Cache });
    return names;
  }

  return {
    // For the command line: the cache, or a probe-only list stored on the first ask. Never waits on the host.
    read: async (): Promise<string[]> => (await read_cache())?.names ?? write([]),
    // Asks the host and probes again. A host that does not answer keeps the names it gave last time.
    refresh: async (): Promise<string[]> => write((await deps.host_fonts()) ?? (await read_cache())?.host ?? []),
  };
}
