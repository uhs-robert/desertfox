// The regex half of page search, run in a Worker (`find_worker.ts`) so the background can stop it. One `exec` cannot be interrupted, and `terminate` is the only way to end a runaway one.
// Pure, so tests run it without a Worker.

export type ScanRequest = { text: string; source: string; flags: string };

export type RegexMatches = { from: Int32Array; to: Int32Array };

export function scan_regex({ text, source, flags }: ScanRequest): RegexMatches {
  const regex = new RegExp(source, flags.includes("g") ? flags : `${flags}g`);
  const from: number[] = [];
  const to: number[] = [];
  for (let hit = regex.exec(text); hit; hit = regex.exec(text)) {
    // An empty match moves on by a whole code point: from the middle of a pair, a `u` regex steps back and finds the same match again.
    if (hit[0] === "") {
      regex.lastIndex += hit.index + 1 < text.length && text.codePointAt(hit.index)! > 0xffff ? 2 : 1;
      continue;
    }
    from.push(hit.index);
    to.push(hit.index + hit[0].length);
  }
  return { from: Int32Array.from(from), to: Int32Array.from(to) };
}
