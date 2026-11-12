// What imported CSS may not load. Imported CSS may reference no address but `data:` ones, so an import cannot make a page fetch from a remote host.
// CSS in the user's own folder or typed in the files editor is never checked: only the import path calls this.

import { css_sources } from "../shared/config_build/source_files.ts";
import type { ConfigFiles } from "../shared/config_build/source_files.ts";

export type CssLimitBreach = { file: string; line: number; what: string };

const HEX = /[0-9a-f]/i;
const FILE_SEPARATOR = "\n";

// The browser gets every CSS file joined in one text (`build_config.ts`), so a rule can run across files: an escape at the end of one file reads
// the start of the next. The check reads the same joined text. Line breaks become one `\n` and escapes are decoded as the CSS spec does, in one
// pass. `origin` keeps, for each decoded character, its offset in the joined text, so a breach maps back to a file and line.
function decode(joined: string): { text: string; origin: number[] } {
  const chars: string[] = [];
  const origin: number[] = [];
  const emit = (text: string, at: number) => {
    for (const unit of text) {
      chars.push(unit);
      origin.push(at);
      if (unit.length > 1) origin.push(at);
    }
  };
  let i = 0;
  while (i < joined.length) {
    const char = joined[i]!;
    if (char !== "\\" || i + 1 >= joined.length || joined[i + 1] === "\n") {
      emit(char, i);
      i++;
    } else if (HEX.test(joined[i + 1]!)) {
      let end = i + 1;
      while (end < joined.length && end - i - 1 < 6 && HEX.test(joined[end]!)) end++;
      const code = Number.parseInt(joined.slice(i + 1, end), 16);
      if (" \t\n".includes(joined[end] ?? "x")) end++;
      emit(code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "�", i);
      i = end;
    } else {
      emit(joined[i + 1]!, i);
      i += 2;
    }
  }
  return { text: chars.join(""), origin };
}

// `image-set(` and `src(` take strings that load, so they are refused whole. A `url(` is let through when it holds a `data:` address or only a
// fragment (`#f` or `%23f`), which names a place in the same document. The optional group is read after the match: a lookahead would let `\s*`
// back off and see the space before a quote instead.
const LIMITED = /@import\b|@font-face\b|\bimage-set\(|\bsrc\(|\burl\(\s*["']?(data:|#|%23)?/gi;

function what_of(match: string): string {
  const keyword = match.toLowerCase();
  return keyword.startsWith("url") ? "url() that is not data:" : keyword;
}

export function css_limit_breaches(files: ConfigFiles): CssLimitBreach[] {
  const sources = css_sources(files, "", []).map(({ file, text }) => ({ file, text: text.replace(/\r\n|[\r\f]/g, "\n") }));
  const joined = sources.map((source) => source.text).join(FILE_SEPARATOR);
  const starts: number[] = [];
  let at = 0;
  for (const source of sources) {
    starts.push(at);
    at += source.text.length + FILE_SEPARATOR.length;
  }
  const { text, origin } = decode(joined);
  const breaches: CssLimitBreach[] = [];
  // Matches come in text order, so one forward pass over `joined` counts every line.
  let file_index = 0;
  let scanned_to = starts[0] ?? 0;
  let line = 1;
  for (const found of text.matchAll(LIMITED)) {
    if (found[1]) continue;
    const offset = origin[found.index]!;
    while (file_index + 1 < starts.length && starts[file_index + 1]! <= offset) {
      file_index++;
      scanned_to = starts[file_index]!;
      line = 1;
    }
    for (; scanned_to < offset; scanned_to++) if (joined[scanned_to] === "\n") line++;
    breaches.push({ file: sources[file_index]!.file, line, what: what_of(found[0]) });
  }
  return breaches;
}
