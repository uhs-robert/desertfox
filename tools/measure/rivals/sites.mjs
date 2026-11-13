// The live-site check (PAGES=sites): the site list, each tool's default keys, and the pure judges that turn what run.mjs saw into a status with a reason. test/rivals_sites.test.ts covers the judges.
// A live page changes under the rig, so a run is a dated snapshot of these sites, not a repeatable benchmark.
// Each site runs in three steps, the way a user meets it:
// 1. Mode on load (`mode_on_load`), information only: where the focus is, through frames, and the tool's mode. A tool that starts in insert mode where the site focused a field is right.
// 2. Leave (`leave`), scored: the tool's own leave key, and whether the focus really left the field, also when the field is inside a frame.
// 3. Normal mode actions, scored: the per-site checks, then scroll, hints, a hint that activates its target, and Escape out of hints. Each is pass or blocked.
import { distance_to, MAX_DISTANCE } from "./match_labels.mjs";

// `extra` names the per-site actions of step 3, run before the generic ones. `path` instead of `url` is a page that pages.mjs serves.
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

export const NORMAL_ACTIONS = ["scroll", "hints", "hints_escape", "activate"];

// Each tool's own default keys, read from its default keymap. Null means the default keymap binds no key for it, which blocks the action.
// Every tool documents Escape as the key that leaves insert mode and a field, so the frame script sends Escape for step 2.
// Vimium 2.4.2, Vimium C 2.12.3 and Tridactyl 1.25.1 bind no key that plays, pauses or sets the volume of a video (read from the pinned builds; Tridactyl's `playpause` is for text to speech).
export const TOOL_KEYS = {
  desertfox: { scroll_down: "j", hint: "f", play_pause: "ap", volume_down: "aV" },
  vimium: { scroll_down: "j", hint: "f", play_pause: null, volume_down: null },
  vimiumc: { scroll_down: "j", hint: "f", play_pause: null, volume_down: null },
  tridactyl: { scroll_down: "j", hint: "f", play_pause: null, volume_down: null },
};

const pass = (reason) => ({ status: "pass", reason });
const fail = (reason) => ({ status: "fail", reason });

// A normal-mode action of step 3 is pass or blocked: a judge's fail means the action did not happen.
export const as_action = (result) => (result.status === "fail" ? { ...result, status: "blocked" } : result);

// The page a site shows a fresh headless profile instead of the real one. A wall is not a fail of any tool, so every check of the site takes its status, `wall` or `login`.
const LOGIN_URL = /\/(login|signin|sign_in|i\/flow\/login)\b|accounts\.google\.com\/|ServiceLogin/i;
const BLOCKED_URL = /^https:\/\/consent\.|\/sorry\/|captcha/i;
const BLOCKED_TEXT = [/unusual traffic/i, /verify (that )?you are (a )?human/i, /are you a robot/i, /enter the characters you see/i, /blocked by network security/i, /sign in to confirm you.re not a bot/i, /before you continue to/i, /access denied/i];
const BLOCKED_TITLE = /^just a moment|^attention required|^access denied/i;

export function page_wall({ url, title, text }) {
  if (LOGIN_URL.test(url)) return { status: "login", reason: `redirected to a login page (${url.slice(0, 80)})` };
  if (BLOCKED_URL.test(url)) return { status: "wall", reason: `redirected to a wall (${url.slice(0, 80)})` };
  if (BLOCKED_TITLE.test(title)) return { status: "wall", reason: `wall page: ${title.slice(0, 60)}` };
  const hit = BLOCKED_TEXT.find((pattern) => pattern.test(text));
  if (hit) return { status: "wall", reason: `wall text: ${text.match(hit)[0]}` };
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

const rect_contains = (outer, inner) => outer.left <= inner.left && outer.top <= inner.top && outer.right >= inner.right && outer.bottom >= inner.bottom;
const same_rect = (a, b) => rect_contains(a, b) && rect_contains(b, a);
// Two targets with one box are an element and its child, so the first stands for both.
const innermost = (targets) => targets.filter((target, index) => !targets.some((other, other_index) => (same_rect(target.rect, other.rect) ? other_index < index : rect_contains(target.rect, other.rect))));

// How much nearer one target must be than the next for the last fallback of pick_activation. Under half the 25 px reach, so a label between two targets never counts.
const CLEAR_MARGIN = 8;

// The label to type for the activation check, so the check knows which element should react. On a dense page a label is near several targets and the nearest can be the neighbour of the real one.
// So the first choice is a label with exactly one target near it, then a label whose center lies inside exactly one target, then a label clearly nearer one target than any other (a toolbar of touching buttons).
export function pick_activation(labels, targets) {
  const typable = labels.filter((label) => label.text.trim());
  const pick = (label, target) => ({ keys: label.text.trim().toLowerCase(), target: target.name });
  // A toolbar or a list item can be a target itself and hold targets, so only the innermost of nested targets near a label count.
  const targets_within = (label, limit) => innermost(targets.filter((target) => distance_to(label_center(label), target.rect) <= limit));
  for (const label of typable) {
    const near = targets_within(label, MAX_DISTANCE);
    if (near.length === 1) return { ...pick(label, near[0]), at: label_center(label) };
  }
  for (const label of typable) {
    const under = targets_within(label, 0);
    if (under.length === 1) return { ...pick(label, under[0]), at: label_center(label) };
  }
  for (const label of typable) {
    const [nearest, second] = targets.map((target) => ({ target, distance: distance_to(label_center(label), target.rect) })).sort((a, b) => a.distance - b.distance);
    if (nearest && nearest.distance <= MAX_DISTANCE && (!second || second.distance - nearest.distance >= CLEAR_MARGIN)) return { ...pick(label, nearest.target), at: label_center(label) };
  }
  return null;
}

export const judge_escape = (labels_left) => (labels_left === 0 ? pass("all labels gone") : fail(`${labels_left} labels still shown`));

// reply: { event: "click" | "focus" | "navigated" | null, on_target, under_label, tag }. under_label is the element a user's click at the label's spot lands on, or its inside, or an ancestor short of the body.
export function judge_activation(reply) {
  if (!reply.event) return fail("typing the label did nothing the page saw");
  if (reply.event === "navigated") return pass("the page navigated");
  if (reply.on_target) return pass(`${reply.event} on the labelled ${reply.tag}`);
  if (reply.under_label) return pass(`${reply.event} on ${reply.tag}, under the label`);
  return fail(`${reply.event} on ${reply.tag}, not the labelled target`);
}

// A focus path runs from the top document into each focused frame: { path, takes_typing, cross_origin }. takes_typing is true when the innermost focused element is a field or editable. A focused frame of another origin cannot be read, so it counts as one that may take typing.
// probe: what the tool's scroll key did on a copy of the page, { reached, prevented }, read in the focused document after the tool had its turn. desertfox_mode: the label DesertFox's mode badge shows, read from its `data-desertfox-mode` attribute.
export function describe_mode_on_load({ focus, probe, desertfox_mode }) {
  const where = `focus ${focus.path}${focus.takes_typing ? " (takes typing)" : ""}`;
  if (desertfox_mode) return { status: "info", reason: `${where}; mode ${desertfox_mode.toLowerCase()} (read from the mode badge)` };
  if (focus.cross_origin) return { status: "info", reason: `${where}; mode unknown: the focused frame is of another origin, so the probe key cannot be watched` };
  if (!probe) return { status: "info", reason: `${where}; mode unknown (no probe answer)` };
  const mode = probe.reached && !probe.prevented ? "insert or passing keys: the page got the scroll key" : "normal: the tool took the scroll key before the page";
  return { status: "info", reason: `${where}; mode inferred ${mode}` };
}

// before and after are focus paths around the tool's leave key.
export function judge_leave({ before, after }) {
  if (!before.takes_typing) return pass(`no field had the focus (${before.path})`);
  if (!after.takes_typing) return pass(`left ${before.path}, focus now ${after.path}`);
  return fail(`focus stayed in ${after.path}`);
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
