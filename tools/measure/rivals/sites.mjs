// The live-site check (PAGES=sites): the site list, each tool's default keys, and the pure judges that turn what run.mjs saw into pass or fail with a reason. test/rivals_sites.test.ts covers the judges.
// A live page changes under the rig, so a run is a dated snapshot of these sites, not a repeatable benchmark.
import { distance_to, MAX_DISTANCE } from "./match_labels.mjs";

// Every site gets the generic checks. `extra` names the per-site checks run before them, on the fresh page. `path` instead of `url` is a page that pages.mjs serves.
// Picked for stable public URLs: Google's own API sample doc and sheet, the first YouTube video, Notion's official public page.
export const SITES = [
  { name: "youtube", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", extra: ["play_pause", "volume"] },
  { name: "google_sheets", url: "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit", extra: ["cell_move"] },
  { name: "google_docs", url: "https://docs.google.com/document/d/195j9eDD3ccgjQRttHhJPymLJUCOUjs-jmwTrekvdjFE/edit", extra: [] },
  { name: "wikipedia", url: "https://en.wikipedia.org/wiki/Firefox", extra: [] },
  { name: "github", url: "https://github.com/mozilla-firefox/firefox", extra: [] },
  { name: "hacker_news", url: "https://news.ycombinator.com/", extra: [] },
  { name: "reddit", url: "https://www.reddit.com/r/firefox/", extra: [] },
  { name: "google_maps", url: "https://www.google.com/maps/@48.8584,2.2945,15z", extra: [] },
  { name: "excalidraw", url: "https://excalidraw.com/", extra: [] },
  { name: "stackblitz", url: "https://stackblitz.com/edit/vitejs-vite", extra: [] },
  { name: "notion_public", url: "https://notion.notion.site/Notion-Official-83715d7703ee4b8699b5e659a4712dd8", extra: [] },
  { name: "google_search", url: "https://www.google.com/search?q=firefox", extra: [] },
  { name: "amazon", url: "https://www.amazon.com/", extra: [] },
  { name: "stack_overflow", url: "https://stackoverflow.com/questions/927358/how-do-i-undo-the-most-recent-local-commits-in-git", extra: [] },
  { name: "mdn", url: "https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a", extra: [] },
  { name: "twitch", url: "https://www.twitch.tv/directory", extra: [] },
  { name: "x_twitter", url: "https://x.com/firefox", extra: ["jk_clash"] },
  // The viewer binds j to the next page itself, so a scroll there is not the tool's.
  { name: "pdf_viewer", url: "https://arxiv.org/pdf/1706.03762", extra: [], note: "Firefox runs no extension content script in its PDF viewer, and the viewer scrolls on its own j" },
  // A local page on 127.0.0.1 with the live YouTube player in an iframe, so the player is cross-site to the page the keys go to.
  { name: "youtube_embed", path: "yt_embed", extra: ["embed_play_pause", "embed_volume"], note: "the rig reads labels in the top document only, so the hint checks cover the link beside the player and not the player's own buttons" },
];

export const GENERIC_CHECKS = ["scroll", "hints", "escape", "activate"];

// Each tool's own default keys, read from its default keymap. Null means the default keymap binds no key for it, which fails the check.
// Vimium 2.4.2, Vimium C 2.12.3 and Tridactyl 1.25.1 bind no key that plays, pauses or sets the volume of a video (read from the pinned builds; Tridactyl's `playpause` is for text to speech).
export const TOOL_KEYS = {
  desertfox: { scroll_down: "j", hint: "f", play_pause: "ap", volume_down: "aV" },
  vimium: { scroll_down: "j", hint: "f", play_pause: null, volume_down: null },
  vimiumc: { scroll_down: "j", hint: "f", play_pause: null, volume_down: null },
  tridactyl: { scroll_down: "j", hint: "f", play_pause: null, volume_down: null },
};

const pass = (reason) => ({ status: "pass", reason });
const fail = (reason) => ({ status: "fail", reason });

// The page a site shows a fresh headless profile instead of the real one. A wall is not a fail of any tool, so every check of the site takes its status.
const LOGIN_URL = /\/(login|signin|sign_in|i\/flow\/login)\b|accounts\.google\.com\/|ServiceLogin/i;
const BLOCKED_URL = /^https:\/\/consent\.|\/sorry\/|captcha/i;
const BLOCKED_TEXT = [/unusual traffic/i, /verify (that )?you are (a )?human/i, /are you a robot/i, /enter the characters you see/i, /blocked by network security/i, /sign in to confirm you.re not a bot/i, /before you continue to/i, /access denied/i];
const BLOCKED_TITLE = /^just a moment|^attention required|^access denied/i;

export function page_wall({ url, title, text }) {
  if (LOGIN_URL.test(url)) return { status: "login", reason: `redirected to a login page (${url.slice(0, 80)})` };
  if (BLOCKED_URL.test(url)) return { status: "blocked", reason: `redirected to a wall (${url.slice(0, 80)})` };
  if (BLOCKED_TITLE.test(title)) return { status: "blocked", reason: `wall page: ${title.slice(0, 60)}` };
  const hit = BLOCKED_TEXT.find((pattern) => pattern.test(text));
  if (hit) return { status: "blocked", reason: `wall text: ${text.match(hit)[0]}` };
  return null;
}

// scroll: { window_dy, element_dy, element, active } from the frame script, the largest change of the window and of any scrollable element.
export function judge_scroll({ window_dy, element_dy, element, active }) {
  if (window_dy !== 0) return pass(`window moved ${Math.round(window_dy)} px`);
  if (element_dy !== 0) return pass(`${element} moved ${Math.round(element_dy)} px`);
  return fail(`nothing scrolled (focus on ${active})`);
}

// Labels sit on or right next to their target, so a label within MAX_DISTANCE of a target counts for it, as on the coverage page.
const label_center = (label) => ({ x: label.rect.left + label.rect.width / 2, y: label.rect.top + label.rect.height / 2 });
const target_of = (label, targets) => {
  let nearest = null;
  let nearest_distance = MAX_DISTANCE;
  for (const target of targets) {
    const distance = distance_to(label_center(label), target.rect);
    if (distance <= nearest_distance) { nearest = target; nearest_distance = distance; }
  }
  return nearest;
};

// labels: [{ text, rect }] visible in the viewport. targets: [{ name, rect }], the visible links, buttons and fields.
export function judge_hints(labels, targets) {
  if (labels.length === 0) return fail(`no labels (${targets.length} visible targets)`);
  const labelled = new Set(labels.map((label) => target_of(label, targets)?.name).filter((name) => name !== undefined));
  if (labelled.size === 0) return fail(`${labels.length} labels, none on a visible target`);
  return pass(`${labels.length} labels, ${labelled.size} of ${targets.length} visible targets labelled`);
}

// The label to type for the activation check, so the check knows which element should react. On a dense page a label is near several targets and the nearest can be the neighbour of the real one.
// So the first choice is a label with exactly one target near it, and the fallback a label whose center lies inside exactly one target.
export function pick_activation(labels, targets) {
  const typable = labels.filter((label) => label.text.trim());
  const pick = (label, target) => ({ keys: label.text.trim().toLowerCase(), target: target.name });
  const targets_within = (label, limit) => targets.filter((target) => distance_to(label_center(label), target.rect) <= limit);
  for (const label of typable) {
    const near = targets_within(label, MAX_DISTANCE);
    if (near.length === 1) return pick(label, near[0]);
  }
  for (const label of typable) {
    const under = targets_within(label, 0);
    if (under.length === 1) return pick(label, under[0]);
  }
  return null;
}

export const judge_escape = (labels_left) => (labels_left === 0 ? pass("all labels gone") : fail(`${labels_left} labels still shown`));

// reply: { event: "click" | "focus" | "navigated" | null, on_target, tag }
export function judge_activation(reply) {
  if (!reply.event) return fail("typing the label did nothing the page saw");
  if (reply.event === "navigated") return pass("the page navigated");
  return reply.on_target ? pass(`${reply.event} on the labelled ${reply.tag}`) : fail(`${reply.event} on ${reply.tag}, not the labelled target`);
}

// A video state is { paused, volume } with volume 0 to 1, or null when the page has no video.
export function judge_play_pause(before, after) {
  if (!before || !after) return fail("no video found");
  // The embedded player also reports YouTube's player state, which tells a cued video from a paused one.
  const player_state = after.state === undefined ? "" : ` (player state ${after.state})`;
  if (before.paused === after.paused) return fail(`stayed ${before.paused ? "paused" : "playing"}${player_state}`);
  return pass(`${before.paused ? "paused" : "playing"} to ${after.paused ? "paused" : "playing"}`);
}

export function judge_volume(before, after) {
  if (!before || !after) return fail("no video found");
  const percent = (state) => Math.round(state.volume * 100);
  if (after.volume < before.volume) return pass(`volume ${percent(before)} to ${percent(after)}`);
  return fail(`volume stayed ${percent(before)}${after.volume > before.volume ? ` (rose to ${percent(after)})` : ""}`);
}

// The Sheets name box shows the selected cell, such as A1.
export function judge_cell_move(before, after) {
  if (before === null) return fail("no name box: the grid did not load");
  return before !== after ? pass(`cell ${before} to ${after}`) : fail(`cell stayed ${before}`);
}

// X binds j to "next post" itself. That moves the focus to a post and scrolls it into view, so a scroll alone cannot be told apart from the tool's.
export function judge_jk_clash({ scrolled, post_focus_moved }) {
  if (post_focus_moved) return fail(scrolled ? "X's own j ran (moved to the next post), the scroll cannot be told apart" : "X's own j ran, the tool's did not");
  return scrolled ? pass("the tool's j scrolled, X's own j did not run") : fail("neither the tool nor X acted on j");
}

// The cell for one check: the status when all runs agree, else each run's status.
export function cell_of(results) {
  if (results.length === 0) return "-";
  const statuses = results.map((result) => result.status);
  return statuses.every((status) => status === statuses[0]) ? statuses[0] : statuses.join("/");
}

// The markdown table of a live-site run: a row per site and check, a column per tool. runs_of: { tool: [{ site, checks: { name: { status, reason } } }] }, one entry per pass.
// The reason shows when every run agrees, so a split cell stays short.
export function sites_table(runs_of, tools) {
  const site_names = SITES.map((site) => site.name).filter((name) => tools.some((tool) => runs_of[tool].some((run) => run.site === name)));
  let markdown = `| site | check | ${tools.join(" | ")} |\n|---|---|${tools.map(() => "---").join("|")}|\n`;
  for (const site of site_names) {
    const check_names = [...new Set(tools.flatMap((tool) => runs_of[tool].filter((run) => run.site === site).flatMap((run) => Object.keys(run.checks))))];
    for (const check of check_names) {
      const cells = tools.map((tool) => {
        const results = runs_of[tool].filter((run) => run.site === site && run.checks[check]).map((run) => run.checks[check]);
        const cell = cell_of(results);
        return results.length > 0 && !cell.includes("/") ? `${cell}: ${results[0].reason}` : cell;
      });
      markdown += `| ${site} | ${check} | ${cells.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |\n`;
    }
  }
  const notes = SITES.filter((site) => site.note && site_names.includes(site.name)).map((site) => `- ${site.name}: ${site.note}.`);
  return notes.length > 0 ? `${markdown}\n${notes.join("\n")}\n` : markdown;
}
