// What each request is answered with, one map per direction. A request exists only as an entry here: the request unions below derive from the maps, so no listener or sender accepts a type that has no entry.
// Four hint frame types travel both ways with different answers, so a single map keyed by `type` cannot hold them.

import type { QualityAnswer } from "../quality.ts";
import type { MediaRequest, MediaResult, MediaScan } from "../media.ts";
import type { QualityProbe, QualityReport, QualityRequest } from "../quality.ts";
import type { InspectAnswer } from "../inspect.ts";
import type { BoundInvocation } from "../invocation.ts";
import type { FrameSiteValues, HINT_SITE_SETTINGS } from "../prefix_tree.ts";
import type * as content from "./content.ts";
import type * as page from "./page.ts";
import type * as tab from "./tab.ts";

export type Entry<Request extends { type: string }, Answer> = { request: Request; answer: Answer };

// The key must equal the request's `type`, so an entry cannot name another request.
type Checked<M extends { [K in keyof M]: Entry<{ type: K & string }, unknown> }> = M;

type Void = undefined;

// What a content script, a bundle or the command line page sends the background. A frame can also get `undefined` where a handler does not answer.
export type ContentRequests = Checked<{
  run: Entry<content.RunRequest, content.RunResponse>;
  mode_changed: Entry<content.ModeChanged, Void>;
  leave_tab_insert: Entry<content.LeaveTabInsert, Void>;
  load_bundle: Entry<content.LoadBundle, content.RunResponse>;
  list_keys: Entry<content.ListKeys, content.WhichKeyPanel>;
  read_repeat_preview: Entry<content.ReadRepeatPreview, string | undefined>;
  issue_cmdline_ticket: Entry<content.IssueCmdlineTicket, string | undefined>;
  relay: Entry<content.Relay, content.Outcome>;
  frame_cue: Entry<content.FrameCue, Void>;
  open_cmdline: Entry<content.OpenCmdline, content.CmdlineOpened | undefined>;
  record_cmdline: Entry<content.RecordCmdline, Void>;
  complete_items: Entry<content.CompleteItems, content.CompleteItemsAnswer | undefined>;
  tab_rows_action: Entry<content.TabRowsActionRequest, content.TabRowsActionAnswer | undefined>;
  open_help: Entry<content.OpenHelp, Void>;
  record_step: Entry<content.RecordStep, Void>;
  read_keymap: Entry<content.ReadKeymap, string | undefined>;
  replay_end: Entry<content.ReplayEnd, { ok: boolean }>;
  replay_stop: Entry<content.ReplayStop, Void>;
  find_scan: Entry<content.FindScan, content.FindScanAnswer>;
  image_action: Entry<content.ImageAction, content.Outcome>;
  inspect_pick: Entry<content.InspectPick, InspectAnswer>;
  read_hint_selectors: Entry<content.ReadHintSelectors, FrameSiteValues<(typeof HINT_SITE_SETTINGS)[number]>>;
  read_strip_patterns: Entry<content.ReadStripPatterns, readonly string[]>;
  register_read: Entry<content.RegisterRead, string | BoundInvocation[] | undefined>;
  register_write: Entry<content.RegisterWrite, content.Outcome | undefined>;
  register_yank: Entry<content.RegisterYank, content.Outcome | undefined>;
  mark_set: Entry<content.MarkSet, content.MarkAnswer>;
  mark_jump: Entry<content.MarkJump, content.MarkAnswer>;
  mark_step: Entry<content.MarkStep, content.MarkAnswer>;
  jump_push: Entry<content.JumpPush, content.JumpAnswer>;
  jump_step: Entry<content.JumpStep, content.JumpAnswer>;
  jump_leave: Entry<content.JumpLeave, Void>;
  editor_open: Entry<content.EditorOpen, content.EditorAnswer>;
  hint_frames_start: Entry<content.HintFramesStart, content.HintFramesStartAnswer>;
  hint_frames_report: Entry<content.HintFramesReport, Void>;
  hint_frames_typed: Entry<content.HintFramesTyped, Void>;
  hint_frames_pick: Entry<content.HintFramesPick, content.HintFramesPickAnswer | undefined>;
  hint_frames_end: Entry<content.HintFramesEnd, Void>;
  hint_frames_unhover: Entry<content.HintFramesUnhover, Void>;
  media_pin: Entry<content.MediaPin, Void>;
  quality_report: Entry<QualityReport, string | undefined>;
  quality_probe: Entry<QualityProbe, boolean>;
  record_timing: Entry<content.RecordTiming, Void>;
  snippet_run: Entry<content.SnippetCall, content.SnippetAnswer>;
}>;

// What an extension page sends the background. A sender that is not an extension page gets a refusal in the shape of the answer.
export type PageRequests = Checked<{
  change_setting: Entry<page.ChangeSetting, page.ChangeSettingAnswer>;
  list_settings: Entry<page.ListSettings, page.ListSettingsAnswer>;
  site_keys: Entry<page.SiteKeysRequest, page.ToolbarAnswer>;
  list_font_names: Entry<page.ListFontNames, string[]>;
  list_bindings: Entry<page.ListBindings, page.ListBindingsAnswer>;
  check_binding: Entry<page.CheckBinding, page.CheckBindingAnswer>;
  change_keymap: Entry<page.ChangeKeymap, page.ChangeKeymapAnswer>;
  list_engines: Entry<page.ListEngines, page.ListEnginesAnswer>;
  change_engines: Entry<page.ChangeEngines, page.ChangeEnginesAnswer>;
  list_aliases: Entry<page.ListAliases, page.ListAliasesAnswer>;
  change_aliases: Entry<page.ChangeAliases, page.ChangeAliasesAnswer>;
  list_imported_themes: Entry<page.ListImportedThemes, page.ListImportedThemesAnswer>;
  change_imported_themes: Entry<page.ChangeImportedThemes, page.ChangeImportedThemesAnswer>;
  list_quickmarks: Entry<page.ListQuickmarks, page.ListQuickmarksAnswer>;
  change_quickmarks: Entry<page.ChangeQuickmarks, page.ChangeQuickmarksAnswer>;
  preview_config_import: Entry<page.PreviewConfigImport, page.ConfigImportPreview>;
  commit_config_import: Entry<page.CommitConfigImport, page.ConfigImportAnswer>;
  export_config: Entry<page.ExportConfig, page.ExportConfigAnswer>;
  list_snippets: Entry<page.ListSnippets, page.ListSnippetsAnswer>;
  remove_snippet: Entry<page.RemoveSnippet, page.ConfigImportAnswer>;
  config_files: Entry<page.ConfigFilesRequest, page.ConfigFilesAnswer>;
  host_start_choice: Entry<page.HostStartChoice, page.HostStartChoiceAnswer>;
  export_sessions: Entry<page.ExportSessions, page.ExportSessionsAnswer>;
  import_sessions: Entry<page.ImportSessions, page.ConfigImportAnswer>;
  toolbar_set_disabled: Entry<Extract<page.ToolbarRequest, { type: "toolbar_set_disabled" }>, page.ToolbarAnswer>;
  toolbar_site: Entry<Extract<page.ToolbarRequest, { type: "toolbar_site" }>, page.ToolbarAnswer>;
  toolbar_reload_config: Entry<Extract<page.ToolbarRequest, { type: "toolbar_reload_config" }>, page.ToolbarAnswer>;
}>;

export type ToBackground = ContentRequests & PageRequests;

// What the background sends a frame of a tab. A frame without the listener answers nothing, so every answer here can also be `undefined` at the sender (see `AskTab`).
export type ToTab = Checked<{
  ping: Entry<tab.Ping, true>;
  focus_page: Entry<tab.FocusPage, boolean>;
  run_in_content: Entry<tab.RunInContent, content.Outcome>;
  replay_hold: Entry<tab.ReplayHold, Void>;
  refusal: Entry<tab.ShowRefusal, Void>;
  media: Entry<tab.MediaStep, Void>;
  set_mode: Entry<tab.SetMode, Void>;
  frame_mode: Entry<tab.FocusedFrameMode, Void>;
  tree_updated: Entry<tab.TreeUpdated, Void>;
  get_selection: Entry<tab.GetSelection, string>;
  get_jump_offset: Entry<tab.GetJumpOffset, { x: number; y: number; url: string }>;
  hint_frames_collect: Entry<tab.HintFramesCollect, Void>;
  hint_frames_labels: Entry<tab.HintFramesLabels, Void>;
  hint_frames_typed: Entry<content.HintFramesTyped, Void>;
  hint_frames_pick: Entry<content.HintFramesPick, content.HintFramesPickAnswer>;
  hint_frames_end: Entry<content.HintFramesEnd, Void>;
  hint_frames_unhover: Entry<content.HintFramesUnhover, Void>;
  editor_done: Entry<tab.EditorDone, boolean>;
  add_bundle_script: Entry<tab.AddBundleScript, tab.AddBundleScriptAnswer>;
  quality_apply: Entry<QualityRequest, QualityAnswer | undefined>;
  media_scan: Entry<Extract<MediaRequest, { type: "media_scan" }>, MediaScan>;
  media_apply: Entry<Extract<MediaRequest, { type: "media_apply" }>, MediaResult>;
}>;

export type RequestOf<M, K extends keyof M> = M[K] extends { request: infer R } ? R : never;
export type AnswerOf<M, K extends keyof M> = { [P in K]: M[P] extends { answer: infer A } ? A : never }[K];
export type AnyRequest<M> = { [K in keyof M]: RequestOf<M, K> }[keyof M];

// The unions the code names, derived from the maps.
export type ContentToBackground = AnyRequest<ContentRequests>;
export type PageToBackground = AnyRequest<PageRequests>;
export type BackgroundToContent = AnyRequest<ToTab>;

type TypeOf<R> = R extends { type: infer T } ? T : never;

// `M` narrows the requests a caller may send. The answer is read from the full map, so a send typed for all requests is assignable to a send typed for a few.
export type Ask<M = ToBackground> = <R extends AnyRequest<M>>(message: R) => Promise<AnswerOf<ToBackground, TypeOf<R> & keyof ToBackground>>;
export type TabAnswer<R> = AnswerOf<ToTab, TypeOf<R> & keyof ToTab> | undefined;
export type AskTab = <R extends AnyRequest<ToTab>>(tab_id: number, message: R, options?: browser.tabs._SendMessageOptions) => Promise<TabAnswer<R>>;

// The global `browser` with typed sends. A sender file declares `declare const browser: MessagingBrowser;`, which shadows the global in that file only and emits nothing. A global overload cannot do this: the library's `any` overload wins.
export type MessagingBrowser = Omit<typeof browser, "runtime" | "tabs"> & {
  runtime: Omit<typeof browser.runtime, "sendMessage"> & { sendMessage: Ask };
  tabs: Omit<typeof browser.tabs, "sendMessage"> & { sendMessage: AskTab };
};
