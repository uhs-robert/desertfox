// Today's imports that break the folder rule in AGENTS.md ("Architecture rules"), one per importing file and target file. Paths are relative to src/. The value is the step B cluster of .plans/desertfox/import-boundaries.md that removes the edge. The list only shrinks: test/import_boundaries.test.ts fails on a new forbidden import and on an entry that no longer matches.
export const EXCEPTIONS: Record<string, string> = {
};

// Imports that break the content rule in AGENTS.md ("Architecture rules"): a bundle folder under src/content imports only itself, the content root, src/content/lib and src/shared, and the root imports no bundle folder (handlers/ is core, not a bundle). Paths are relative to src/. The value is the PR of .plans/desertfox/bundle-contracts.md that removes the edge, or "permanent" for the edge that stays. The list only shrinks: test/import_boundaries.test.ts fails on a new cross-bundle import and on an entry that no longer matches. src/cmdline/host.ts is the one other importer and sits outside this list, because it imports only the content root.
export const CONTENT_EXCEPTIONS: Record<string, string> = {
  "content/bundle_calls.ts -> content/hints/actions.ts": "PR 6",
  "content/bundle_calls.ts -> content/site_actions/clipboard.ts": "PR 6",
  "content/bundle_calls.ts -> content/site_actions/send_key.ts": "PR 6",
  "content/editor/clipboard_fallback.ts -> content/site_actions/clipboard.ts": "PR 6",
  "content/editor/clipboard_fallback.ts -> content/site_actions/send_key.ts": "PR 6",
  "content/editor/main.ts -> content/text/field_writer.ts": "PR 6",
  "content/editor/main.ts -> content/text/secret_field.ts": "PR 6",
  "content/hints/insert_text.ts -> content/text/field_writer.ts": "PR 6",
  "content/hints/insert_text.ts -> content/text/host_editable.ts": "PR 6",
  "content/hints/main.ts -> content/page/leave_watch.ts": "PR 6",
  "content/hints/main.ts -> content/text/entry.ts": "PR 6",
  "content/item_act/main.ts -> content/hints/actions.ts": "PR 6",
  "content/item/overlay.ts -> content/hints/follow.ts": "PR 6",
  "content/media/frame_media.ts -> content/quality/youtube.ts": "permanent",
  "content/media/main.ts -> content/quality/youtube.ts": "permanent",
  "content/next_page/follow_links.ts -> content/hints/actions.ts": "PR 6",
  "content/next_page/follow_links.ts -> content/hints/candidates.ts": "PR 6",
  "content/next_page/follow_links.ts -> content/hints/headings.ts": "PR 6",
  "content/next_page/main.ts -> content/hints/actions.ts": "PR 6",
  "content/next_page/main.ts -> content/page/leave_watch.ts": "PR 6",
  "content/page/main.ts -> content/text/entry.ts": "PR 6",
  "content/tree/main.ts -> content/hints/actions.ts": "PR 6",
};
