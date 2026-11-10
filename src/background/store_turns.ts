// What the stores that keep private data in `storage.session` share: a queue that runs their writes one at a time, and the cleanup that drops private data when the last private window closes.

// Each write reads, edits and writes, so two writes from two tabs must not interleave. A failed job does not block the next one.
export function create_write_queue() {
  let queue: Promise<unknown> = Promise.resolve();
  return <Result>(job: () => Promise<Result>): Promise<Result> => {
    const turn = queue.then(job, job);
    queue = turn.catch(() => undefined);
    return turn;
  };
}

export type PrivateStore = { clear_private_without_window: (has_private_window: () => Promise<boolean>) => Promise<void> };

// Cleans up at start and after every window closes, with one listener for all stores. A failed cleanup only leaves private data until the next one, so it warns and goes on.
export function wire_private_cleanup(stores: readonly PrivateStore[], windows: { onRemoved: { addListener: (listener: () => void) => void }; getAll: () => Promise<{ incognito: boolean }[]> }): void {
  const has_private_window = async () => (await windows.getAll()).some((window) => window.incognito);
  const clean = () => void Promise.all(stores.map((store) => store.clear_private_without_window(has_private_window))).catch((error: unknown) => console.warn("desertfox: could not clear the private data", error));
  windows.onRemoved.addListener(clean);
  clean();
}
