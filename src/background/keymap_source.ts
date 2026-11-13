// The compiled keymap in `storage.local`, kept in memory after the first read. A burst of frames (a tab with 100 subframes) asks for it at once, and each storage read parses the whole stored value. The copy refills from storage and drops when `storage.onChanged` reports the key, so a restart of the background starts empty and loses nothing.

import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";

type KeymapStorage = Pick<typeof browser.storage.local, "get">;
type ChangeEvent = Pick<typeof browser.storage.onChanged, "addListener">;

// Callers share the one object and must not change it.
export type KeymapSource = { read: () => Promise<CompiledKeymap | undefined> };

export function create_keymap_source(storage: KeymapStorage, changed: ChangeEvent): KeymapSource {
  let copy: { value: CompiledKeymap | undefined } | undefined;
  let filling: Promise<CompiledKeymap | undefined> | undefined;
  // A change bumps the generation, so a read that started before it cannot store what it got.
  let generation = 0;
  const fill = (): Promise<CompiledKeymap | undefined> => {
    const started = generation;
    const reading: Promise<CompiledKeymap | undefined> = storage
      .get(COMPILED_KEYMAP_STORAGE_KEY)
      .then((stored) => {
        const value = stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined;
        if (started !== generation) return read();
        copy = { value };
        return value;
      })
      .finally(() => {
        if (filling === reading) filling = undefined;
      });
    filling = reading;
    return reading;
  };
  const read = async (): Promise<CompiledKeymap | undefined> => (copy ? copy.value : (filling ?? fill()));
  changed.addListener((changes, area) => {
    if (area !== "local" || !(COMPILED_KEYMAP_STORAGE_KEY in changes)) return;
    generation++;
    copy = undefined;
    filling = undefined;
  });
  return { read };
}

// Made when the module loads, so its listener runs before any listener added later, and those can read the new map at once.
const browser_source: KeymapSource | undefined = typeof browser === "undefined" || browser.storage?.onChanged === undefined ? undefined : create_keymap_source(browser.storage.local, browser.storage.onChanged);

// Only the browser's own `storage.local` is cached, because only it reports changes to the listener here. Any other storage (a test's fake) reads straight through.
export async function stored_keymap(storage: KeymapStorage): Promise<CompiledKeymap | undefined> {
  if (browser_source === undefined || storage !== browser.storage.local) return (await storage.get(COMPILED_KEYMAP_STORAGE_KEY))[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined;
  return browser_source.read();
}
