import { create_timing_log } from "./timing_log.ts";
import { TIMINGS_STORAGE_KEY } from "./storage_keys.ts";

export const browser_timing_log = create_timing_log(
  { get: (key) => browser.storage.session.get(key), set: (items) => browser.storage.session.set(items) },
  TIMINGS_STORAGE_KEY,
);
