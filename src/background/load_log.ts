import { keep_chain } from "../shared/swallow.ts";
// The last bundle loads, kept in storage for the key test to read.

export type LoadLogStorage = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

const KEPT_ENTRIES = 20;

export function create_load_log(storage: LoadLogStorage, key: string) {
  // One read-then-write at a time, so concurrent loads do not overwrite each other's entry.
  let chain: Promise<void> = Promise.resolve();
  return {
    // A storage failure is swallowed: the log is a diagnostic and must not fail the load it describes.
    record: (entry: unknown): Promise<void> => {
      chain = keep_chain(chain
        .then(async () => {
          const stored = await storage.get(key);
          const earlier = (stored[key] as unknown[] | undefined) ?? [];
          await storage.set({ [key]: [...earlier, entry].slice(-KEPT_ENTRIES) });
        }));
      return chain;
    },
  };
}
