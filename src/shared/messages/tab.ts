// Messages the background sends to the frames of a tab with `tabs.sendMessage`, and to extension pages that load the bundles.

import type { Mode } from "../command.ts";
import type { Invocation } from "../invocation.ts";
import type { Refusal } from "./content.ts";

// To an extension page: add the script tag for a bundle file. The answer is an AddBundleScriptAnswer, sent once the script has run or failed.
export type AddBundleScript = { type: "add_bundle_script"; file: string };
export type AddBundleScriptAnswer = { ok: true } | { ok: false; message: string };

export type RunInContent = {
  type: "run_in_content";
  invocations: Invocation[];
  // Set for a macro replay: the steps run as a held key's repeats do, so a scroll jumps and the next step reads where it ended.
  repeat?: true;
};

// A macro replay reached this page: hold its keys until the replay ends. The page asks when with `replay_end`.
export type ReplayHold = {
  type: "replay_hold";
};

// One toast on the page. A refusal leaves `kind` out and shows as an error.
export type ToastKind = "error" | "warning" | "info" | "success";

export type ShowRefusal = {
  type: "refusal";
  refusal: Refusal;
  kind?: ToastKind;
};

export type SetMode = {
  type: "set_mode";
  mode: Mode;
  // Sent by the insert hold to every frame of the tab. A frame under an all-off rule ignores it.
  held?: true;
};

// The tab's media mode started or ended in another frame. The frame takes the step a fullscreen change takes (`fullscreen_step`), so a frame in another mode keeps it, and an open hint or line only changes where it returns to.
// The type string is short because content.js holds it.
export type MediaStep = {
  type: "media";
  on: boolean;
  // The step is for item mode, not media mode (`tab_item.ts`).
  item?: true;
  // The frame whose own report started the mode. It is in the mode already, so it skips the step: a step that reaches it after it left the mode would put it back.
  from?: number | undefined;
};

// To the top frame: the mode of the child frame that holds focus, which the badge shows in place of the top frame's own. Absent when no child frame holds focus.
// `frame_id` is that child frame, whose count of visual item mode the badge shows.
// `parked` says a frame of another site was handed back to the top page, so the top page's hints label that frame too.
// The type string is short because content.js holds it.
export type FocusedFrameMode = {
  type: "frame_mode";
  mode?: Mode;
  frame_id?: number | undefined;
  parked?: true;
};

// The compiled keymap in `storage.local` changed: read it again.
export type TreeUpdated = {
  type: "tree_updated";
};

// Asks for the page selection. The `page` bundle answers with a string, and content.js does not answer.
export type GetSelection = {
  type: "get_selection";
};

// Asks the `page` bundle for the scroll offset of the box the scroll keys move. It answers `{ x, y, url }`, the url being the page's own, and content.js does not answer.
export type GetJumpOffset = {
  type: "get_jump_offset";
};

// Moves keyboard focus from the browser chrome into the page and leaves no field focused.
// `park` is the hand-back of a frame the user has not entered. A frame answers whether it is still free (no click or key in it). The top frame answers true and blurs only an iframe element, never a field.
export type FocusPage = {
  type: "focus_page";
  park?: true;
};

// Presence check before the background injects the content script. Any truthy answer counts.
export type Ping = {
  type: "ping";
};

// Asks every frame of the tab for its hint candidates, found with the keyboard frame's `hint.run` args. Each frame answers with a `HintFramesReport`. A frame keeps the candidates of the latest session only.
export type HintFramesCollect = {
  type: "hint_frames_collect";
  session_id: string;
  args: Record<string, unknown>;
};

// A frame's share of the session's labels, one per candidate it reported, in its own order.
export type HintFramesLabels = {
  type: "hint_frames_labels";
  session_id: string;
  labels: string[];
};

// To the frame that opened an edit, when the editor ends. `text` is present only when the file changed. A frame with another `token` (a new page) ignores it.
export type EditorDone = { type: "editor_done"; token: string; text?: string };

