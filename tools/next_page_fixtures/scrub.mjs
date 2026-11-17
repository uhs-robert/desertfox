// Drops the tracking parts of the addresses in a saved page: every query parameter but the paging and search ones the labels read, and the fragment.
// Run alone, it scrubs every saved page in test/fixtures/next_page/ in place: node tools/next_page_fixtures/scrub.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

export const FIXTURES = new URL("../../test/fixtures/next_page/", import.meta.url);

const KEPT_PARAMS = new Set(["p", "page", "_pgn", "start", "after", "before", "offset", "timeline_page", "q", "_nkw", "query", "f"]);

export function scrub_href(href) {
  const base = "https://scrub.invalid";
  let url;
  try {
    url = new URL(href, base);
  } catch {
    return href;
  }
  if (!/^https?:$/.test(url.protocol)) return href;
  for (const name of [...url.searchParams.keys()]) if (!KEPT_PARAMS.has(name)) url.searchParams.delete(name);
  url.hash = "";
  const absolute = url.href;
  return absolute.startsWith(base) && !href.startsWith(base) ? absolute.slice(base.length) : absolute;
}

export function scrub_page(node) {
  if (node.a?.href !== undefined) node.a.href = scrub_href(node.a.href);
  for (const child of node.c ?? []) scrub_page(child);
}

const write_page = (file, page) => writeFileSync(file, gzipSync(JSON.stringify(page), { level: 9 }));
export const save_page = (name, page) => {
  scrub_page(page.root);
  write_page(new URL(`${name}.json.gz`, FIXTURES), page);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const file of readdirSync(FIXTURES).filter((name) => name.endsWith(".json.gz"))) {
    const page = JSON.parse(gunzipSync(readFileSync(new URL(file, FIXTURES))).toString("utf8"));
    save_page(file.replace(/\.json\.gz$/, ""), page);
  }
}
