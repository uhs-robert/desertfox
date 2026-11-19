// Mirrors the stored key edits into `autoconfig.toml` through the native host. The file is write-only: nothing reads it back.
// A failed write never blocks or undoes an edit, because browser storage holds the edits and this file only copies them.
// No setting goes here: settings.toml holds the settings, and the consent settings stay on this machine.

import { stringify } from "smol-toml";
import type { KeymapEdits } from "./edit_layers.ts";
import type { NativeFailure } from "./native_client.ts";

export type AutoconfigMirrorDeps = {
  write_autoconfig: (toml: string) => Promise<void>;
  warn: (message: string) => void;
};

// The host writes its own header above this line.
const KEY_EDITS_NOTE = "# The key edits made in the browser, as keymap.d mode tables. Settings live in settings.toml.\n";

const failure_of = (error: unknown): NativeFailure | "other" => (error as { failure?: NativeFailure })?.failure ?? "other";

export function create_autoconfig_mirror(deps: AutoconfigMirrorDeps) {
  // Writes go out one at a time, so the file ends at the newest edits and never at an older write that finished last.
  let write_queue: Promise<void> = Promise.resolve();
  const warned = new Set<string>();

  function warn_once(error: unknown): void {
    const failure = failure_of(error);
    // Without the permission the user has not set up the host, so the missing mirror is expected and not news.
    if (failure === "no_permission" || warned.has(failure)) return;
    warned.add(failure);
    deps.warn(`desertfox: autoconfig.toml not written: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    // Returns at once. The promise it gives back is for tests: it settles when this write has run, and never rejects.
    mirror(key_edits: KeymapEdits): Promise<void> {
      // Serialized now, so a later edit cannot change what this write holds. A value TOML cannot hold only warns.
      let toml: string;
      try {
        toml = Object.keys(key_edits).length > 0 ? `${KEY_EDITS_NOTE}\n${stringify(key_edits)}` : KEY_EDITS_NOTE;
      } catch (error) {
        warn_once(error);
        return Promise.resolve();
      }
      const written = write_queue.then(() => deps.write_autoconfig(toml)).catch(warn_once);
      write_queue = written;
      return written;
    },
  };
}
