// Writes the bundle script tags into an extension page. The page keeps a `<!-- bundle-tags -->` marker right after its content.js tag.

import { BUNDLE_NAMES, EXTENSION_PAGE_SKIPPED } from "../src/shared/bundles.ts";

export const BUNDLE_TAGS_MARKER = "<!-- bundle-tags -->";

export function with_bundle_tags(html: string, file: string): string {
  if (!html.includes(BUNDLE_TAGS_MARKER)) throw new Error(`${file} has no ${BUNDLE_TAGS_MARKER} marker`);
  const tags = BUNDLE_NAMES.filter((name) => !(name in EXTENSION_PAGE_SKIPPED)).map((name) => `<script src="${name}.js"></script>`);
  return html.replace(BUNDLE_TAGS_MARKER, tags.join("\n"));
}
