// What the background does for a subframe that holds the keys while the top frame draws: the one-time cue after `;f`, and the keys' return to the top frame when the focused frame hides.

import type { CommandMeta } from "../shared/command.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import { DEFAULT_TOAST_MS } from "../shared/default_settings.ts";
import { key_labels } from "../cmdline/completion/keys.ts";

export type FrameOverlayDeps = {
  // The child frame that holds the keyboard focus, or undefined when the top frame does.
  focused_child: (tab_id: number) => Promise<number | undefined>;
  focus_top: (tab_id: number) => Promise<unknown>;
  forget_line_target: (tab_id: number, frame_id: number) => Promise<void>;
  keymap: () => Promise<CompiledKeymap | undefined>;
  commands: () => readonly CommandMeta[];
  toast_in_top: (tab_id: number, message: string, duration_ms: number) => Promise<unknown>;
};

// The second sentence names the key bound to `frame.exit` in the user's keymap, and is left out when no key is bound. It names no Escape: what Escape does depends on the page.
export function frame_cue_text(exit_key: string | undefined): string {
  return exit_key === undefined ? "Keys act in this frame." : `Keys act in this frame. ${exit_key} returns to the page.`;
}

export function create_frame_overlay(deps: FrameOverlayDeps) {
  return {
    cue: async (tab_id: number): Promise<void> => {
      const keymap = await deps.keymap();
      const exit_key = key_labels(keymap, deps.commands(), "normal").get("frame.exit")?.split(" ")[0];
      await deps.toast_in_top(tab_id, frame_cue_text(exit_key), keymap?.toast_ms ?? DEFAULT_TOAST_MS);
    },
    // Only a frame the tab still counts as focused gives the keys back: a frame that hides while the focus sits elsewhere must not take it from there. A line aimed at the frame loses its aim.
    hidden: async (tab_id: number, frame_id: number): Promise<void> => {
      await deps.forget_line_target(tab_id, frame_id);
      if ((await deps.focused_child(tab_id)) === frame_id) await deps.focus_top(tab_id);
    },
  };
}
