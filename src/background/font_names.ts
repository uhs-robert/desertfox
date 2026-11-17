// The font names the font settings suggest: the host's installed fonts when the host answers, else a canvas probe of the built-in candidates. The list is cached in storage, so the command line opens with no probe and no host call.

import { FONT_CANDIDATES, merge_font_names, probe_fonts } from "../shared/font_candidates.ts";
import type { MeasureWidth } from "../shared/font_candidates.ts";
import { keep_chain } from "../shared/swallow.ts";
import { FONT_NAMES_STORAGE_KEY } from "./storage_keys.ts";

export type FontNamesDeps = {
  storage: Pick<typeof browser.storage.local, "get" | "set">;
  // The host's installed families, or undefined when the host is missing (not installed, no permission, too old). A call that fails (timeout, error) throws.
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

  // Reads and writes queue, so a probe-only write from `read` never lands after a refresh that has the host's fonts.
  let latest_turn = 0;
  let last: Promise<unknown> = Promise.resolve();
  const queued = <T>(job: () => Promise<T>): Promise<T> => {
    const run = last.then(job);
    last = keep_chain(run);
    return run;
  };

  // The host's list stands alone: Firefox resolves fontconfig aliases, so the probe also reports names (Arial) that are not installed.
  async function write(host: string[] | undefined): Promise<string[]> {
    const measure = deps.measure();
    const names = merge_font_names(host ?? (measure ? probe_fonts(FONT_CANDIDATES, measure) : []));
    await deps.storage.set({ [FONT_NAMES_STORAGE_KEY]: { host: host ?? [], names } satisfies Cache });
    return names;
  }

  return {
    // For the command line: the cache, or a probe-only list stored on the first ask. Never waits on the host.
    read: (): Promise<string[]> => queued(async () => (await read_cache())?.names ?? write(undefined)),
    // Asks the host. A missing host gives the probe list. A failed call keeps the cached host list, and gives the probe list only when none was cached.
    // The host is asked outside the queue, so a slow host never holds up `read`. Only the newest refresh writes.
    refresh: async (): Promise<string[]> => {
      const turn = ++latest_turn;
      let host: string[] | undefined;
      let failed = false;
      try {
        host = await deps.host_fonts();
      } catch {
        failed = true;
      }
      return queued(async () => {
        const cached = await read_cache();
        if (turn !== latest_turn || (failed && cached !== undefined && cached.host.length > 0)) return cached?.names ?? write(undefined);
        return write(failed ? undefined : host);
      });
    },
  };
}
