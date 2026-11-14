// The live-site check (PAGES=sites): the site list, each tool's default keys, and the pure judges that turn what run.mjs saw into a status with a reason. test/rivals_sites.test.ts covers the judges.
// A live page changes under the rig, so a run is a dated snapshot of these sites, not a repeatable benchmark.
// Each site runs in three steps, the way a user meets it:
// 1. Mode on load (`mode_on_load`), information only: where the focus is, through frames, and the tool's mode. A tool that starts in insert mode where the site focused a field is right.
// 2. Leave (`leave`), scored: the tool's own leave key, and whether the focused element, in whatever frame holds it, still takes typing.
// Known gap: on Stack Overflow the Google sign-in frame does not come back after gF and the reload, so frame_hints and frame_activate read unknown there. It was not investigated, and the doc counts Reddit and X as the frame sites.
// 2b. Frame branch, DesertFox only and only when its badge reads FRAME after the leave step. The site dictates focus and DesertFox does not override it, so a site that focuses a frame (Reddit and X focus a Google sign-in frame) leaves DesertFox working inside that frame until the user dismisses it or leaves with gF. The rivals keep keys on the page and show no badge, so they have no frame mode to score. The branch has two parts. `gF` (`frame_leave`) runs right after the leave step, so step 3 meets the same page, popup included, for every tool. The checks inside the frame run last, after a reload that brings the frame back: hints in the frame (`frame_hints`) and a hint that activates a control in it (`frame_activate`), which dismisses the popup. A pass that never reaches frame mode records the three frame rows as n/a.
// 3. Normal mode actions, scored: the per-site checks, then scroll, hints, a hint that activates its target, and Escape out of hints. Each is pass or blocked, or wrong_target when the hint acted on another element than its label's target.
// Steps 1 to 3 run on one page load. Only the frame checks at the end of the DesertFox frame branch load it again. Every key goes in through the parent process, so Firefox routes it to the focused frame as it routes a user's key, also into a frame of another origin.
// The rig reads the page with the same rule for every tool. Only facts come from the page, and the functions here judge them, so the tests cover the rules.
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
  { name: "youtube_embed", path: "yt_embed", extra: ["embed_play_pause", "embed_volume"], note: "the hint checks match labels to targets of the top document, so they cover the link beside the player and not the player's own buttons. Labels inside the player frame count only for Escape out of hints" },
];

export const NORMAL_ACTIONS = ["scroll", "hints", "hints_escape", "activate"];

// Every check a site record can hold for one tool. Wall and error records fill all of them, so a new check name goes here once. Only DesertFox has the frame checks.
export const FRAME_ROWS = ["frame_leave", "frame_hints", "frame_activate"];
export const check_names_of = (site, tool) => ["mode_on_load", "leave", ...(tool === "desertfox" ? FRAME_ROWS : []), ...site.extra, ...NORMAL_ACTIONS];

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
// The key did act, on another element than the labelled one. That is not the tool failing to act, so it has its own status. The label-to-target guess of the rig can be the cause as well.
const wrong_target = (reason) => ({ status: "wrong_target", reason });

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

// The page's main scroller, when the window itself does not scroll: the scrollable element with the largest visible area, if it covers at least a quarter of the viewport. A carousel, a chat list or a code line is never the main scroller, so its own movement cannot pass a scroll check.
// candidates: [{ index, visible_area }] of the elements that can scroll vertically.
export function main_scroller(candidates, viewport_area) {
  const largest = [...candidates].sort((a, b) => b.visible_area - a.visible_area)[0];
  return largest && largest.visible_area >= viewport_area / 4 ? largest : null;
}

// scroll: { window_dy, main_dy, main, active }, each change against a baseline taken just before the key. main names the main scroller, or null when the page has none.
export function judge_scroll({ window_dy, main_dy, main, active }) {
  if (Math.abs(window_dy) >= 1) return pass(`window moved ${Math.round(window_dy)} px`);
  if (main && Math.abs(main_dy) >= 1) return pass(`main scroller ${main} moved ${Math.round(main_dy)} px`);
  return fail(`nothing scrolled: neither the window nor ${main ? `the main scroller ${main}` : "a main scroller (none found)"} moved (focus on ${active})`);
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

// labels: [{ text, rect }] visible in the top document's viewport. targets: [{ name, rect }], the visible links, buttons and fields of the top document. frame_labels: the labels visible inside the page's frames, which cannot sit on a top-document target.
export function judge_hints(labels, targets, frame_labels = 0) {
  const in_frames = frame_labels > 0 ? `, ${frame_labels} more inside frames` : "";
  if (labels.length === 0) return fail(`no labels on the page${in_frames} (${targets.length} visible targets)`);
  const labelled = new Set(labels.map((label) => target_of(label, targets)?.name).filter((name) => name !== undefined));
  if (labelled.size === 0) return fail(`${labels.length} labels${in_frames}, none on a visible target`);
  return pass(`${labels.length} labels${in_frames}, ${labelled.size} of ${targets.length} visible targets labelled`);
}

const rect_contains = (outer, inner) => outer.left <= inner.left && outer.top <= inner.top && outer.right >= inner.right && outer.bottom >= inner.bottom;
const same_rect = (a, b) => rect_contains(a, b) && rect_contains(b, a);
// Two targets with one box are an element and its child, so the first stands for both.
const innermost = (targets) => targets.filter((target, index) => !targets.some((other, other_index) => (same_rect(target.rect, other.rect) ? other_index < index : rect_contains(target.rect, other.rect))));

// How much nearer one target must be than the next for the last fallback of pick_activation. Under half the 25 px reach, so a label between two targets never counts.
const CLEAR_MARGIN = 8;

// The label to type for the activation check, so the check knows which element should react. A label belongs to the target whose box holds its center, and a label that only sits near a target can belong to an element the target list lacks.
// So the first choice is a label whose center lies inside exactly one target. Only when no label does, the fallbacks run: a label with exactly one target near it, then a label clearly nearer one target than any other (a toolbar of touching buttons). `via` records which choice made the pick.
export function pick_activation(labels, targets) {
  const typable = labels.filter((label) => label.text.trim());
  const pick = (label, target, via) => ({ keys: label.text.trim().toLowerCase(), target: target.name, via, at: label_center(label) });
  // A toolbar or a list item can be a target itself and hold targets, so only the innermost of nested targets near a label count.
  const targets_within = (label, limit) => innermost(targets.filter((target) => distance_to(label_center(label), target.rect) <= limit));
  for (const label of typable) {
    const under = targets_within(label, 0);
    if (under.length === 1) return pick(label, under[0], "inside");
  }
  for (const label of typable) {
    const near = targets_within(label, MAX_DISTANCE);
    if (near.length === 1) return pick(label, near[0], "near");
  }
  for (const label of typable) {
    const [nearest, second] = targets.map((target) => ({ target, distance: distance_to(label_center(label), target.rect) })).sort((a, b) => a.distance - b.distance);
    if (nearest && nearest.distance <= MAX_DISTANCE && (!second || second.distance - nearest.distance >= CLEAR_MARGIN)) return pick(label, nearest.target, "nearest");
  }
  return null;
}

// labels_left counts the labels visible in the top document and in every frame. unread_frames counts the frames the rig could not read, so a zero there is not proof.
export function judge_escape(labels_left, unread_frames = 0) {
  if (labels_left > 0) return fail(`${labels_left} labels still shown`);
  if (unread_frames > 0) return { status: "unknown", reason: `no label left where the rig could read, ${unread_frames} frames unread` };
  return pass("all labels gone, frames included");
}

// Two addresses are the same page when they differ only in the fragment.
export function same_address(a, b) {
  const without_fragment = (url) => { const parsed = new URL(url); parsed.hash = ""; return parsed.href; };
  try { return without_fragment(a) === without_fragment(b); } catch { return false; }
}

// One rule for every tool, wherever it draws its label: typing the label must click or focus the labelled target or an element inside it, or navigate to the target's own address when it is a link.
// A click on an ancestor never counts, because a wrapper or the body holds every target.
// reply: { event: "click" | "focus" | null, relation: "self" | "inside" | "other", tag, navigated } from the page, plus expected_href (the link's address, or null), url_before and url_after from the parent process.
export function judge_activation({ event, relation, tag, navigated, expected_href, url_before, url_after }) {
  if (event && relation !== "other") return pass(`${event} on the labelled ${tag}${relation === "inside" ? " (an element inside it)" : ""}`);
  if (navigated || (url_after && url_after !== url_before)) {
    if (expected_href && url_after && same_address(url_after, expected_href)) return pass(`navigated to the link's address`);
    if (expected_href) return wrong_target(`navigated to ${String(url_after).slice(0, 80)}, not the link's address ${expected_href.slice(0, 80)}`);
    return fail(`navigated to ${String(url_after).slice(0, 80)}, but the target is not a link`);
  }
  if (event) return wrong_target(`${event} on ${tag}, not the labelled target or inside it`);
  return fail("typing the label did nothing the page saw");
}

// Input types that take typed text. A checkbox, a button or a range takes keys only as shortcuts.
const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number", "date", "datetime-local", "month", "time", "week"]);

// facts: the focused element of one document, { tag, id, type, editable, design_mode, read_only, disabled }, as the page reports it. A select takes typed letters to pick an option.
export function takes_typing(facts) {
  if (!facts) return false;
  if (["input", "textarea", "select"].includes(facts.tag)) {
    if (facts.disabled || facts.read_only) return false;
    return facts.tag !== "input" || TEXT_INPUT_TYPES.has(facts.type);
  }
  return Boolean(facts.editable || facts.design_mode);
}

const describe_facts = (facts) => (facts ? facts.tag + (facts.id ? `#${facts.id}` : "") : "none");

// chain: the focused element of each document from the top page down to the focused frame, which can be of another origin, or null when a document could not be read. An empty chain means the focus is in the browser's own window, not the page.
// Only the innermost element decides: a frame whose own document holds no field does not take typing.
export function focus_of(chain) {
  if (!chain) return { readable: false, path: "unreadable", takes_typing: null };
  if (chain.length === 0) return { readable: true, path: "(browser window, not the page)", takes_typing: false };
  return { readable: true, path: chain.map(describe_facts).join(" > "), takes_typing: takes_typing(chain.at(-1)), depth: chain.length };
}

// DesertFox's badge reads FRAME while a subframe holds the focus in normal mode.
export const is_frame_mode = (badge_label) => /^frame$/i.test(badge_label ?? "");

// Information, recorded after the leave step like the mode on load. badge_label: DesertFox's badge, or null.
export function describe_mode_after_leave({ focus, badge_label }) {
  return { status: "info", reason: `focus ${focus.path}; mode ${badge_label ? badge_label.toLowerCase() : "unknown"} (read from the mode badge)${is_frame_mode(badge_label) ? ": frame mode, the site focused a frame and DesertFox works inside it" : ""}` };
}

// frame_labels: labels visible inside the frames after the hint key. The top page's labels do not count, because the branch asks whether hints reach the focused frame.
export function judge_frame_hints({ frame_labels, top_labels }) {
  if (frame_labels > 0) return pass(`${frame_labels} labels inside the focused frame${top_labels > 0 ? `, ${top_labels} on the top page` : ""}`);
  return fail(`no labels inside the focused frame (${top_labels} on the top page)`);
}

// A control reacted when the frame saw a click or focus on an element, or when the frame is gone, as after a dismissed popup.
// reply: { event: "click" | "focus" | null, tag } from the frame, or null when it could not be read. context_gone: the frame's browsing context left the page. Only that counts as a dismissal, and only while the top page keeps its address: a badge that stops reading FRAME can mean the typed label did something else, and a top-level navigation removes every frame.
export function judge_frame_activation({ reply, context_gone, url_before, url_after }) {
  if (context_gone && !same_address(url_before, url_after)) return fail(`the top page navigated to ${String(url_after).slice(0, 80)}, which is no dismissal`);
  if (context_gone) return pass("the frame went away (dismissed)");
  if (reply?.event) return pass(`${reply.event} on a ${reply.tag} inside the frame`);
  return fail("typing a label in the frame did nothing the frame saw");
}

// mode_after and focus_after follow gF. The leave works when the badge no longer reads FRAME and the focus sits in the top page.
export function judge_frame_leave({ mode_after, focus_after }) {
  if (!focus_after.readable) return { status: "unknown", reason: `the focus could not be read (${focus_after.path})` };
  if (is_frame_mode(mode_after) || focus_after.depth > 1) return fail(`still in the frame: mode ${String(mode_after).toLowerCase()}, focus ${focus_after.path}`);
  return pass(`left the frame, mode ${String(mode_after).toLowerCase()}, focus ${focus_after.path}`);
}

// focus: from focus_of. probe: what the tool's scroll key did, { reached, prevented }, read in the focused document after the tool had its turn, or null. desertfox_mode: the label DesertFox's mode badge shows, read from its `data-desertfox-mode` attribute. The rivals have no such badge, so their mode is inferred and is weaker evidence.
export function describe_mode_on_load({ focus, probe, desertfox_mode }) {
  const where = `focus ${focus.path}${focus.takes_typing ? " (takes typing)" : ""}`;
  if (desertfox_mode) return { status: "info", reason: `${where}; mode ${desertfox_mode.toLowerCase()} (read from the mode badge)` };
  if (!probe) return { status: "info", reason: `${where}; mode unknown (no probe answer)` };
  const mode = probe.reached && !probe.prevented ? "insert or passing keys: the page got the scroll key" : "normal: the tool took the scroll key before the page";
  return { status: "info", reason: `${where}; mode inferred ${mode}` };
}

// before and after come from focus_of, around the tool's leave key. A focus the rig could not read is unknown, never a fail.
export function judge_leave({ before, after }) {
  if (!before.readable || !after.readable) return { status: "unknown", reason: `the focus could not be read (before: ${before.path}, after: ${after.path})` };
  if (!before.takes_typing) return pass(`no field had the focus (${before.path})`);
  if (!after.takes_typing) return pass(`left ${before.path}, focus now ${after.path}`);
  return fail(`focus stayed in ${after.path}, which takes typing`);
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

// A check that errored on a timeout says nothing about the tool, so run.mjs runs the site once more and keeps both records.
const TIMEOUT_REASON = /timeout|no answer|did not finish|never answered/i;
export const timed_out = (record) => Object.values(record.checks).some((check) => check.status === "error" && TIMEOUT_REASON.test(check.reason));

// The cell for one check over the passes: the status more than half the runs got, or `split` with each status when none did. majority: the status, null on a split. A run's record is its own, so the reason shown comes from a run with the majority status.
export function cell_of(results) {
  if (results.length === 0) return { text: "-", majority: null };
  const counts = new Map();
  for (const { status } of results) counts.set(status, (counts.get(status) ?? 0) + 1);
  const [status, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (count * 2 <= results.length) return { text: `split ${results.map((result) => result.status).join("/")}`, majority: null };
  return { text: count === results.length ? status : `${status} ${count}/${results.length}`, majority: status };
}

// A record replaced by a retry stays in the JSON but takes no part in the cell.
export const scored_runs = (runs) => runs.filter((run) => !run.retried);

// The markdown table of a live-site run: a row per site and check, a column per tool. runs_of: { tool: [{ site, checks: { name: { status, reason } } }] }, one entry per pass and retry.
// A cell shows the majority status with the reason from one of its runs. A split cell shows only the statuses.
export function sites_table(runs_of, tools) {
  const site_names = SITES.map((site) => site.name).filter((name) => tools.some((tool) => runs_of[tool].some((run) => run.site === name)));
  let markdown = `| site | check | ${tools.join(" | ")} |\n|---|---|${tools.map(() => "---").join("|")}|\n`;
  for (const site of site_names) {
    const check_names = [...new Set(tools.flatMap((tool) => scored_runs(runs_of[tool]).filter((run) => run.site === site).flatMap((run) => Object.keys(run.checks))))];
    for (const check of check_names) {
      const cells = tools.map((tool) => {
        const results = scored_runs(runs_of[tool]).filter((run) => run.site === site && run.checks[check]).map((run) => run.checks[check]);
        const { text, majority } = cell_of(results);
        return majority ? `${text}: ${results.find((result) => result.status === majority).reason}` : text;
      });
      markdown += `| ${site} | ${check} | ${cells.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |\n`;
    }
  }
  const notes = SITES.filter((site) => site.note && site_names.includes(site.name)).map((site) => `- ${site.name}: ${site.note}.`);
  return notes.length > 0 ? `${markdown}\n${notes.join("\n")}\n` : markdown;
}
