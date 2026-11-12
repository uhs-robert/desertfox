// The last timings of the extension, kept in `storage.session` so a background restart keeps them. One entry is `[name, ms]`.

export type TimingStorage = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

export type Timing = [name: string, ms: number];

export const KEPT_TIMINGS = 300;

export type TimingLog = ReturnType<typeof create_timing_log>;

export function create_timing_log(storage: TimingStorage, key: string) {
  // Records of one tick wait here and go out in one write, so a burst costs one read and one write of the ring. A restart loses only this batch.
  let pending: Timing[] = [];
  let scheduled: Promise<void> | undefined;
  // One read-then-write at a time, so two batches do not overwrite each other.
  let chain: Promise<void> = Promise.resolve();

  async function flush(): Promise<void> {
    scheduled = undefined;
    const batch = pending;
    pending = [];
    const earlier = ((await storage.get(key))[key] as Timing[] | undefined) ?? [];
    await storage.set({ [key]: [...earlier, ...batch].slice(-KEPT_TIMINGS) });
  }

  return {
    // A storage failure is swallowed: a timing is a diagnostic and must not fail what it measures.
    record: (name: string, ms: number): Promise<void> => {
      pending.push([name, ms]);
      scheduled ??= chain = chain.then(flush).catch(() => undefined);
      return scheduled;
    },
    read: async (): Promise<Timing[]> => {
      await chain;
      return (((await storage.get(key))[key] as Timing[] | undefined) ?? []).filter((entry) => typeof entry[0] === "string" && Number.isFinite(entry[1]));
    },
  };
}

// The one timing a content script may send. Anything else is dropped, so a sender cannot fill the ring with other names or bad numbers.
export function accept_hint_timing(log: Pick<TimingLog, "record">, request: { name?: unknown; ms?: unknown }): void {
  if (request.name === "hint.build" && typeof request.ms === "number" && Number.isFinite(request.ms) && request.ms >= 0) void log.record("hint.build", request.ms);
}
