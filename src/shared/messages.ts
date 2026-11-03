// Messages between content script and background, sent with `runtime.sendMessage`
// and `tabs.sendMessage`. The `type` field selects the shape.

import type { BundleName } from "./bundles.ts";
import type { Mode } from "./command.ts";
import type { BoundInvocation, Invocation } from "./invocation.ts";

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
  invocations: BoundInvocation[];
  mode: Mode;
};

export type ModeChanged = {
  type: "mode_changed";
  mode: Mode;
};

// Asks the background to inject a bundle into the sender's frame. The answer is a RunResponse: ok once the script has run.
export type LoadBundle = {
  type: "load_bundle";
  name: BundleName;
};

// From the command line page when it opens: asks for the history and the lists the grammar needs to read bare words.
export type OpenCmdline = {
  type: "open_cmdline";
};

export type CmdlineOpened = {
  // Oldest first.
  history: string[];
  sources: { search_engines: string[]; containers: string[] };
};

// From the command line page when typed text parsed. The background keeps it in the history unless the tab is private.
export type RecordCmdline = {
  type: "record_cmdline";
  text: string;
};

export type ContentToBackground = RunRequest | ModeChanged | LoadBundle | OpenCmdline | RecordCmdline;

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

// Asks for the page selection. The content script answers with a string.
export type GetSelection = {
  type: "get_selection";
};

// Moves keyboard focus from the browser chrome into the page and leaves no field focused.
export type FocusPage = {
  type: "focus_page";
};

// Presence check before the background injects the content script. Any truthy answer counts.
export type Ping = {
  type: "ping";
};

export type BackgroundToContent = RunInContent | ShowRefusal | SetMode | TreeUpdated | GetSelection | FocusPage | Ping;
