// Messages between content script and background, sent with `runtime.sendMessage`
// and `tabs.sendMessage`. The `type` field selects the shape.

import type { Mode } from "./command.ts";
import type { Invocation } from "./invocation.ts";

// Why a command did not run. The content script shows `message` as a toast,
// the background falls back to a notification where no content script exists.
export type Refusal = {
  id: string;
  message: string;
};

// Content to background

export type RunRequest = {
  type: "run";
  // Runs in order. Tab and frame come from the message sender.
  invocations: Invocation[];
  mode: Mode;
};

export type ModeChanged = {
  type: "mode_changed";
  mode: Mode;
};

export type ContentToBackground = RunRequest | ModeChanged;

export type RunResponse = { ok: true } | { ok: false; refusal: Refusal };

// Background to content

export type RunInContent = {
  type: "run_in_content";
  invocations: Invocation[];
};

export type ShowRefusal = {
  type: "refusal";
  refusal: Refusal;
};

export type SetMode = {
  type: "set_mode";
  mode: Mode;
};

// The compiled keymap in `storage.local` changed: read it again.
export type TreeUpdated = {
  type: "tree_updated";
};

export type BackgroundToContent = RunInContent | ShowRefusal | SetMode | TreeUpdated;
