// The one-time cue after `;f` focused a frame: a toast in the top frame that says where the keys act now.

import type { CommandMeta } from "../shared/command.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import { DEFAULT_TOAST_MS } from "../shared/default_settings.ts";
import { key_labels } from "../cmdline/completion/keys.ts";

export type FrameCueDeps = {
  keymap: () => Promise<CompiledKeymap | undefined>;
  commands: () => readonly CommandMeta[];
  toast_in_top: (tab_id: number, message: string, duration_ms: number) => Promise<unknown>;
};

// The second sentence names the key bound to `frame.exit` in the user's keymap, and is left out when no key is bound. It names no Escape: what Escape does depends on the page.
export function frame_cue_text(exit_key: string | undefined): string {
  return exit_key === undefined ? "Keys act in this frame." : `Keys act in this frame. ${exit_key} returns to the page.`;
}

export function create_frame_cue(deps: FrameCueDeps): (tab_id: number) => Promise<void> {
  return async (tab_id) => {
    const keymap = await deps.keymap();
    const exit_key = key_labels(keymap, deps.commands(), "normal").get("frame.exit")?.split(" ")[0];
    await deps.toast_in_top(tab_id, frame_cue_text(exit_key), keymap?.toast_ms ?? DEFAULT_TOAST_MS);
  };
}
