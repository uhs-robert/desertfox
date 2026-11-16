// A seeded history and the other finder sources, the same on every run, for the completion ranking tests. No real data.
import type { HistoryNode } from "../../src/background/complete_items.ts";

// The clock the rows are dated against. Tests pin `Date.now` to it, because the use boost decays with age.
export const FIXTURE_NOW = Date.UTC(2026, 10, 16, 12);

const DAY_MS = 24 * 60 * 60 * 1000;

// mulberry32: small, fast and the same in every engine.
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ["firefox", "rust", "async", "github", "mdn", "docs", "issue", "pull", "request", "release", "notes", "tab", "close", "window", "search", "engine", "keyboard", "vim", "hint", "scroll", "bookmark", "history", "iter", "stream", "error", "type", "script", "Promise", "Worker", "port", "message", "cache", "index", "query", "rank", "score", "fuzzy", "match", "Linux", "arch", "wiki", "news", "video", "music", "map", "mail", "calendar", "weather", "café", "Zürich"];
const HOSTS = ["github.com", "developer.mozilla.org", "docs.rs", "news.ycombinator.com", "wiki.archlinux.org", "www.youtube.com", "mail.example.com", "maps.example.org", "stackoverflow.com", "crates.io", "en.wikipedia.org", "blog.rust-lang.org", "bugzilla.mozilla.org", "reddit.com", "gitlab.com"];

export type Fixture = {
  history: HistoryNode[];
  bookmarks: { title: string; url: string }[];
  quickmarks: Record<string, string>;
  closed: { session_id: string; title: string; url: string }[];
  // Open tabs of the line's privacy, some on addresses that history and bookmarks also hold.
  tabs: { id: number; title: string; url: string; last_used: number; active?: true }[];
};

export function history_fixture(rows = 8000, seed = 7): Fixture {
  const random = seeded(seed);
  const pick = <Item>(items: readonly Item[]): Item => items[Math.floor(random() * items.length)]!;
  const history: HistoryNode[] = [];
  // Two of the rows are the home pages below.
  for (let index = 0; index < rows - 2; index++) {
    const host = pick(HOSTS);
    const title_words = Array.from({ length: 2 + Math.floor(random() * 5) }, () => pick(WORDS));
    const path = Array.from({ length: 1 + Math.floor(random() * 4) }, () => pick(WORDS).toLowerCase()).join("/");
    // Some rows have no title, so the address stands in for it.
    const title = random() < 0.05 ? "" : `${title_words.join(" ")} - ${host}`;
    history.push({ url: `https://${host}/${path}/${index}`, title, visit_count: 1 + Math.floor(random() ** 3 * 80), last_visit: FIXTURE_NOW - Math.floor(index * 0.02 * DAY_MS + random() * DAY_MS) });
  }
  // A few home pages, so a site row is sometimes left out because a row holds its host.
  history.splice(3, 0, { url: "https://github.com/", title: "GitHub", visit_count: 40, last_visit: FIXTURE_NOW - DAY_MS });
  history.splice(9, 0, { url: "https://docs.rs/", title: "Docs.rs", visit_count: 12, last_visit: FIXTURE_NOW - 2 * DAY_MS });
  // Newest first, as `history.search` answers.
  history.sort((left, right) => (right.last_visit as number) - (left.last_visit as number));
  const bookmarks = [
    ...Array.from({ length: 200 }, (_, index) => {
      const host = pick(HOSTS);
      return { title: `${pick(WORDS)} ${pick(WORDS)} bookmark ${index}`, url: `https://${host}/bm/${index}` };
    }),
    // Addresses history also holds, so the bookmark takes the history row's boost and the row shows once.
    ...history.filter((_, index) => index % 97 === 5).map((node) => ({ title: node.title || (node.url as string), url: node.url as string })),
  ];
  const quickmarks: Record<string, string> = { g: "https://github.com/", r: history[40]!.url as string, m: "https://developer.mozilla.org/en-US/", n: bookmarks[3]!.url, z: "https://unvisited.example/" };
  const closed = Array.from({ length: 20 }, (_, index) => ({ session_id: `s${index}`, title: index % 3 === 0 ? (history[index * 11]!.title as string) : `closed ${pick(WORDS)} ${index}`, url: index % 3 === 0 ? (history[index * 11]!.url as string) : `https://${pick(HOSTS)}/closed/${index}` }));
  const tabs = Array.from({ length: 30 }, (_, index) => {
    const from_history = index % 4 === 0 ? history[index * 7] : undefined;
    return {
      id: 100 + index,
      title: from_history ? (from_history.title as string) || (from_history.url as string) : `tab ${pick(WORDS)} ${pick(WORDS)} ${index}`,
      url: from_history ? (from_history.url as string) : `https://${pick(HOSTS)}/tab/${index}`,
      last_used: FIXTURE_NOW - index * 60_000,
      ...(index === 0 ? { active: true as const } : {}),
    };
  });
  return { history, bookmarks, quickmarks, closed, tabs };
}
