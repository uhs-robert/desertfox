// What imported CSS may not load. Imported CSS may reference no address but `data:` ones, so an import cannot make a page fetch from a remote host.
// CSS in the user's own folder or typed in the files editor is never checked: only the import path calls this.

import type { ConfigFiles } from "../shared/config_build/source_files.ts";

export type CssLimitBreach = { file: string; line: number; what: string };

const is_css_path = (path: string) => path === "style.css" || (path.startsWith("style.d/") && path.endsWith(".css"));

// The whole text is searched, comments and strings included, so no tokenizer rule can hide a keyword. Line breaks become one `\n` and escapes are
// decoded first, as the CSS spec does before it reads a token. A refused keyword inside a comment costs the user one deletion.
function plain_css(text: string): string {
  return text
    .replace(/\r\n|[\r\f]/g, "\n")
    .replace(/\\([0-9a-f]{1,6})[ \t\n]?/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\uFFFD";
    })
    .replace(/\\([^\n])/g, "$1");
}

// `image-set(` and `src(` take strings that load, so they are refused whole. The optional `data:` group is read after the match: a lookahead would let `\s*` back off and see the space before a quote instead.
const LIMITED = /@import\b|@font-face\b|\bimage-set\(|\bsrc\(|\burl\(\s*["']?(data:)?/gi;

function what_of(match: string): string {
  const keyword = match.toLowerCase();
  return keyword.startsWith("url") ? "url() that is not data:" : keyword;
}

export function css_limit_breaches(files: ConfigFiles): CssLimitBreach[] {
  const breaches: CssLimitBreach[] = [];
  for (const [file, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (!is_css_path(file)) continue;
    const css = plain_css(text);
    let line = 1;
    let counted_to = 0;
    for (const found of css.matchAll(LIMITED)) {
      if (found[1]) continue;
      for (let newline = css.indexOf("\n", counted_to); newline !== -1 && newline < found.index; newline = css.indexOf("\n", counted_to)) {
        line++;
        counted_to = newline + 1;
      }
      breaches.push({ file, line, what: what_of(found[0]) });
    }
  }
  return breaches;
}
