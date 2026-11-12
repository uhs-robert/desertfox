// The last timings of the extension, kept in `storage.session` so a background restart keeps them. One entry is `[name, ms]`.

export type TimingStorage = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

export type Timing = [name: string, ms: number];

export const KEPT_TIMINGS = 300;

export function create_timing_log(storage: TimingStorage, key: string) {
  // One read-then-write at a time, so concurrent records do not overwrite each other.
  let chain: Promise<void> = Promise.resolve();
  return {
    // A storage failure is swallowed: a timing is a diagnostic and must not fail what it measures.
    record: (name: string, ms: number): Promise<void> => {
      chain = chain
        .then(async () => {
          const earlier = ((await storage.get(key))[key] as Timing[] | undefined) ?? [];
          await storage.set({ [key]: [...earlier, [name, ms] satisfies Timing].slice(-KEPT_TIMINGS) });
        })
        .catch(() => undefined);
      return chain;
    },
    read: async (): Promise<Timing[]> => {
      await chain;
      return (((await storage.get(key))[key] as Timing[] | undefined) ?? []).filter((entry) => typeof entry[0] === "string" && Number.isFinite(entry[1]));
    },
  };
}
