// Today's imports that break the folder rule in AGENTS.md ("Architecture rules"), one per importing file and target file. Paths are relative to src/. The value is the step B cluster of .plans/desertfox/import-boundaries.md that removes the edge. The list only shrinks: test/import_boundaries.test.ts fails on a new forbidden import and on an entry that no longer matches.
export const EXCEPTIONS: Record<string, string> = {
  "background/frame_cue.ts -> cmdline/completion/keys.ts": "C9",
  "background/main.ts -> cmdline/word_lookup.ts": "C9",
  "background/omnibox.ts -> cmdline/completion/keys.ts": "C9",
  "background/omnibox.ts -> cmdline/completion/live.ts": "C9",
  "background/omnibox.ts -> cmdline/completion/sources.ts": "C9",
  "background/omnibox.ts -> cmdline/word_lookup.ts": "C9",
  "help/grant_panel.ts -> content/caret/copy_text.ts": "C8",
  "help/dom.ts -> content/caret/copy_text.ts": "C8",
  "shared/config_build/schemas.ts -> background/default_keymap.ts": "C10",
};
