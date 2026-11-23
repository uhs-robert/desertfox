// Today's imports that break the folder rule in AGENTS.md ("Architecture rules"), one per importing file and target file. Paths are relative to src/. The value is the step B cluster of .plans/desertfox/import-boundaries.md that removes the edge. The list only shrinks: test/import_boundaries.test.ts fails on a new forbidden import and on an entry that no longer matches.
export const EXCEPTIONS: Record<string, string> = {
};

// Imports that break the content rule in AGENTS.md ("Architecture rules"): a bundle folder under src/content imports only itself, the content root, src/content/lib and src/shared, and the root imports no bundle folder (handlers/ is core, not a bundle). Paths are relative to src/. Every entry is "permanent": the edge stays by design. The list only shrinks: test/import_boundaries.test.ts fails on a new cross-bundle import and on an entry that no longer matches. src/cmdline/host.ts is the one other importer and sits outside this list, because it imports only the content root.
export const CONTENT_EXCEPTIONS: Record<string, string> = {
  "content/media/frame_media.ts -> content/quality/youtube.ts": "permanent",
  "content/media/main.ts -> content/quality/youtube.ts": "permanent",
};
