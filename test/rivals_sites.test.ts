import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error The rig is plain JavaScript without types.
import { as_action, FRAME_ROWS, check_names_of, cell_of, describe_mode_after_leave, describe_mode_on_load, is_frame_mode, judge_frame_activation, judge_frame_hints, judge_frame_leave, focus_of, judge_activation, judge_leave, judge_cell_move, judge_escape, judge_hints, judge_jk_clash, judge_play_pause, judge_scroll, judge_volume, main_scroller, page_wall, pick_activation, same_address, sites_table, SITES, takes_typing, timed_out, TOOL_KEYS } from "../tools/measure/rivals/sites.mjs";

const rect = (left: number, top: number, width = 160, height = 30) => ({ left, top, right: left + width, bottom: top + height, width, height });
const target = (name: string, top: number) => ({ name, rect: rect(20, top) });
const label = (text: string, left: number, top: number) => ({ text, rect: rect(left, top, 12, 16) });

test("a consent redirect, a bot check and a login redirect are walls, a normal page is not", () => {
  assert.equal(page_wall({ url: "https://consent.youtube.com/m?continue=x", title: "", text: "" })?.status, "wall");
  assert.equal(page_wall({ url: "https://www.google.com/sorry/index?q=1", title: "", text: "" })?.status, "wall");
  assert.equal(page_wall({ url: "https://stackoverflow.com/q/1", title: "Just a moment...", text: "" })?.status, "wall");
  assert.equal(page_wall({ url: "https://www.amazon.com/", title: "Amazon", text: "Enter the characters you see below" })?.status, "wall");
  assert.equal(page_wall({ url: "https://old.reddit.com/login/?dest=x", title: "", text: "" })?.status, "login");
  assert.equal(page_wall({ url: "https://x.com/i/flow/login", title: "", text: "" })?.status, "login");
  assert.equal(page_wall({ url: "https://en.wikipedia.org/wiki/Firefox", title: "Firefox - Wikipedia", text: "Firefox is a web browser" }), null);
});

test("the main scroller is the largest scrollable element, and only if it covers a quarter of the viewport", () => {
  const viewport_area = 1000 * 800;
  assert.equal(main_scroller([{ index: 0, visible_area: 300 * 40 }, { index: 1, visible_area: 900 * 700 }], viewport_area)?.index, 1);
  // A carousel or a heading that scrolls is never the main scroller.
  assert.equal(main_scroller([{ index: 0, visible_area: 600 * 200 }], viewport_area), null);
  assert.equal(main_scroller([], viewport_area), null);
});

test("a scroll counts only for the window or the main scroller, and no movement fails and names the focus", () => {
  assert.equal(judge_scroll({ window_dy: 50, main_dy: 0, main: null, active: "body" }).status, "pass");
  assert.equal(judge_scroll({ window_dy: 0, main_dy: -40, main: "div#main", active: "body" }).status, "pass");
  assert.equal(judge_scroll({ window_dy: 0.4, main_dy: 0, main: null, active: "body" }).status, "fail");
  const stuck = judge_scroll({ window_dy: 0, main_dy: 0, main: null, active: "input#search" });
  assert.equal(stuck.status, "fail");
  assert.match(stuck.reason, /input#search/);
});

test("hints pass when a label sits on a visible target and fail with no label or only stray labels", () => {
  const targets = [target("0", 100), target("1", 200)];
  assert.equal(judge_hints([label("a", 20, 100)], targets).status, "pass");
  assert.equal(judge_hints([], targets).status, "fail");
  assert.equal(judge_hints([label("a", 600, 600)], targets).status, "fail");
  // Labels inside a frame cannot sit on a target of the top page, so they are reported and do not pass.
  const frames_only = judge_hints([], targets, 4);
  assert.equal(frames_only.status, "fail");
  assert.match(frames_only.reason, /4 more inside frames/);
});

test("the activation label is the first inside exactly one target, typed in lower case, with the label's center", () => {
  const crowded = [target("0", 100), target("1", 135), target("2", 300)];
  assert.deepEqual(pick_activation([label("AB", 20, 125), label("CD", 20, 300)], crowded), { keys: "cd", target: "2", via: "inside", at: { x: 26, y: 308 } });
  assert.equal(pick_activation([label("AB", 600, 600)], crowded), null);
});

test("a label inside a target beats an earlier label that only sits near another target", () => {
  // A label 10 px above the target belongs to an element the list lacks: the label on the target wins, as on a breadcrumb under a header link.
  const breadcrumb = [{ name: "crumb", rect: rect(16, 28, 75, 32) }];
  const picked = pick_activation([{ text: "k", rect: rect(16, 0, 17, 18) }, { text: "aa", rect: rect(16, 28, 24, 18) }], breadcrumb);
  assert.equal(picked?.keys, "aa");
  assert.equal(picked?.via, "inside");
});

test("a label inside one target records via inside, and with none inside a lone near target wins, then a label clearly nearer one target", () => {
  const crowded = [target("0", 100), target("1", 135)];
  assert.equal(pick_activation([label("AB", 20, 136)], crowded)?.target, "1");
  assert.equal(pick_activation([label("AB", 20, 136)], crowded)?.via, "inside");
  assert.equal(pick_activation([{ text: "k", rect: rect(16, 0, 17, 18) }], [{ name: "crumb", rect: rect(16, 28, 75, 32) }])?.via, "near");
  // Touching toolbar buttons side by side: the label sits just outside both, 2 px from one and 14 px from the other.
  const toolbar = [{ name: "left", rect: rect(0, 50, 30, 30) }, { name: "right", rect: rect(30, 50, 30, 30) }];
  assert.equal(pick_activation([{ text: "x", rect: rect(10, 20, 12, 16) }], toolbar)?.target, "left");
  // Both buttons are near, one clearly nearer: the last fallback.
  assert.equal(pick_activation([{ text: "x", rect: rect(4, 30, 12, 16) }], toolbar)?.via, "nearest");
  // A toolbar that is a target itself and holds the button: the button, the innermost, wins.
  const nested = [{ name: "bar", rect: rect(0, 0, 1000, 60) }, { name: "button", rect: rect(8, 7, 48, 48) }];
  assert.equal(pick_activation([{ text: "d", rect: rect(3, 1, 12, 16) }], nested)?.target, "button");
  // A link and its child with one box count as one target.
  assert.equal(pick_activation([{ text: "e", rect: rect(10, 10, 12, 16) }], [{ name: "link", rect: rect(0, 0, 80, 30) }, { name: "child", rect: rect(0, 0, 80, 30) }])?.target, "link");
  // Halfway between the two: neither is clearly nearer.
  assert.equal(pick_activation([{ text: "x", rect: rect(24, 20, 12, 16) }], toolbar), null);
});

const page = "https://example.com/list";
const stayed = { navigated: false, expected_href: null, url_before: page, url_after: page };

test("activation passes on a click or focus on the labelled target or inside it, and never on an ancestor", () => {
  assert.equal(judge_activation({ ...stayed, event: "click", relation: "self", tag: "a" }).status, "pass");
  assert.equal(judge_activation({ ...stayed, event: "click", relation: "inside", tag: "yt-interaction" }).status, "pass");
  assert.equal(judge_activation({ ...stayed, event: "focus", relation: "self", tag: "input" }).status, "pass");
  // The masthead holds the labelled button: a click there is the same for every tool, a fail.
  assert.equal(judge_activation({ ...stayed, event: "click", relation: "other", tag: "ytd-masthead#masthead" }).status, "wrong_target");
  assert.equal(judge_activation({ ...stayed, event: null, relation: null, tag: null }).status, "fail");
});

test("a navigation passes only when it reaches the link's own address", () => {
  const link = "https://example.com/item?id=4";
  const went = (url_after: string, expected_href: string | null) => judge_activation({ event: null, relation: null, tag: null, navigated: true, expected_href, url_before: page, url_after });
  assert.equal(went(link, link).status, "pass");
  assert.equal(went(`${link}#top`, link).status, "pass");
  assert.equal(went("https://example.com/other", link).status, "wrong_target");
  // A target that is not a link has no address to reach.
  assert.equal(went("https://example.com/other", null).status, "fail");
  // The frame script's state went with a process switch: the new address alone decides.
  assert.equal(judge_activation({ event: null, navigated: false, expected_href: link, url_before: page, url_after: link }).status, "pass");
});

test("two addresses are the same page when only the fragment differs", () => {
  assert.equal(same_address("https://a.test/x?q=1#s", "https://a.test/x?q=1"), true);
  assert.equal(same_address("https://a.test/x?q=1", "https://a.test/x?q=2"), false);
  assert.equal(same_address("not a url", "https://a.test/"), false);
});

test("a text field, a select and an editable take typing, and a button, a checkbox or a read-only field do not", () => {
  assert.equal(takes_typing({ tag: "input", type: "search" }), true);
  assert.equal(takes_typing({ tag: "textarea" }), true);
  assert.equal(takes_typing({ tag: "select" }), true);
  assert.equal(takes_typing({ tag: "div", editable: true }), true);
  assert.equal(takes_typing({ tag: "body", design_mode: true }), true);
  assert.equal(takes_typing({ tag: "input", type: "checkbox" }), false);
  assert.equal(takes_typing({ tag: "input", type: "text", read_only: true }), false);
  assert.equal(takes_typing({ tag: "textarea", disabled: true }), false);
  assert.equal(takes_typing({ tag: "button" }), false);
  assert.equal(takes_typing({ tag: "body" }), false);
});

test("the focus is judged by the innermost document, so a frame whose own focus left its field does not take typing", () => {
  const frame_field = focus_of([{ tag: "iframe", id: "comments" }, { tag: "div", id: "editor", editable: true }]);
  assert.deepEqual(frame_field, { readable: true, path: "iframe#comments > div#editor", takes_typing: true, depth: 2 });
  // A tool that blurs the field inside the frame leaves the focus on the frame's body.
  assert.equal(focus_of([{ tag: "iframe", id: "comments" }, { tag: "body" }]).takes_typing, false);
  // An ad frame with no field is not a field.
  assert.equal(focus_of([{ tag: "iframe" }, { tag: "none" }]).takes_typing, false);
  assert.equal(focus_of([]).takes_typing, false);
  assert.equal(focus_of(null).readable, false);
});

const in_frame_field = focus_of([{ tag: "iframe", id: "docs" }, { tag: "div", editable: true }]);
const on_page = focus_of([{ tag: "body" }]);
const in_frame_body = focus_of([{ tag: "iframe", id: "docs" }, { tag: "body" }]);

test("the mode on load is information: read for DesertFox, inferred from the probe key for the others", () => {
  const read = describe_mode_on_load({ focus: in_frame_field, probe: null, desertfox_mode: "INSERT" });
  assert.equal(read.status, "info");
  assert.match(read.reason, /iframe#docs > div \(takes typing\); mode insert \(read from the mode badge\)/);
  assert.match(describe_mode_on_load({ focus: in_frame_field, probe: { reached: true, prevented: false }, desertfox_mode: null }).reason, /inferred insert or passing keys/);
  assert.match(describe_mode_on_load({ focus: on_page, probe: { reached: false, prevented: false }, desertfox_mode: null }).reason, /inferred normal/);
  assert.match(describe_mode_on_load({ focus: on_page, probe: { reached: true, prevented: true }, desertfox_mode: null }).reason, /inferred normal/);
  assert.match(describe_mode_on_load({ focus: in_frame_field, probe: null, desertfox_mode: null }).reason, /mode unknown \(no probe answer\)/);
});

test("the leave key passes when the focused element stops taking typing, in the frame or on the page, fails when it stays, and is unknown when unread", () => {
  assert.equal(judge_leave({ before: in_frame_field, after: on_page }).status, "pass");
  assert.equal(judge_leave({ before: in_frame_field, after: in_frame_body }).status, "pass");
  assert.equal(judge_leave({ before: on_page, after: on_page }).status, "pass");
  const stuck = judge_leave({ before: in_frame_field, after: in_frame_field });
  assert.equal(stuck.status, "fail");
  assert.match(stuck.reason, /stayed in iframe#docs > div/);
  assert.equal(judge_leave({ before: in_frame_field, after: focus_of(null) }).status, "unknown");
});

test("a normal-mode action that did not happen is blocked, and a pass stays a pass", () => {
  assert.equal(as_action({ status: "fail", reason: "no labels" }).status, "blocked");
  assert.equal(as_action({ status: "pass", reason: "ok" }).status, "pass");
  assert.equal(as_action({ status: "error", reason: "timeout" }).status, "error");
});

test("escape passes only when no label is left in any frame, and is unknown when a frame was unread", () => {
  assert.equal(judge_escape(0).status, "pass");
  assert.equal(judge_escape(3).status, "fail");
  assert.equal(judge_escape(3, 1).status, "fail");
  assert.equal(judge_escape(0, 1).status, "unknown");
});

test("play or pause passes when the paused state flips, and the volume check wants a lower volume", () => {
  assert.equal(judge_play_pause({ paused: true, volume: 1 }, { paused: false, volume: 1 }).status, "pass");
  assert.match(judge_play_pause({ paused: true, volume: 1, state: 5 }, { paused: true, volume: 1, state: 5 }).reason, /player state 5/);
  assert.equal(judge_play_pause(null, null).status, "fail");
  assert.equal(judge_volume({ paused: false, volume: 1 }, { paused: false, volume: 0.95 }).status, "pass");
  assert.equal(judge_volume({ paused: false, volume: 0.5 }, { paused: false, volume: 0.5 }).status, "fail");
});

test("a cell move needs the name box to change", () => {
  assert.equal(judge_cell_move("A1", "A2").status, "pass");
  assert.equal(judge_cell_move("A1", "A1").status, "fail");
  assert.equal(judge_cell_move(null, null).status, "fail");
});

test("the X j check passes only when the tool scrolled and X's own j did not run", () => {
  assert.equal(judge_jk_clash({ scrolled: true, post_focus_moved: false }).status, "pass");
  assert.equal(judge_jk_clash({ scrolled: true, post_focus_moved: true }).status, "fail");
  assert.equal(judge_jk_clash({ scrolled: false, post_focus_moved: false }).status, "fail");
});

test("a cell takes the status of the majority of runs, with the count when they differ, and is split with no majority", () => {
  assert.deepEqual(cell_of([{ status: "pass" }, { status: "pass" }, { status: "pass" }]), { text: "pass", majority: "pass" });
  assert.deepEqual(cell_of([{ status: "pass" }, { status: "blocked" }, { status: "pass" }]), { text: "pass 2/3", majority: "pass" });
  assert.deepEqual(cell_of([{ status: "pass" }, { status: "fail" }]), { text: "split pass/fail", majority: null });
  assert.deepEqual(cell_of([{ status: "pass" }, { status: "fail" }, { status: "error" }]), { text: "split pass/fail/error", majority: null });
  assert.deepEqual(cell_of([]), { text: "-", majority: null });
});

test("a site is retried when a check timed out, and not for a plain fail", () => {
  assert.equal(timed_out({ checks: { scroll: { status: "error", reason: "long job timeout" } } }), true);
  assert.equal(timed_out({ checks: { scroll: { status: "error", reason: "rdp: no answer from server1.conn0" } } }), true);
  assert.equal(timed_out({ checks: { scroll: { status: "blocked", reason: "nothing scrolled" } } }), false);
});

test("the table has a row per site and check, with the reason when the runs agree, and the site notes below", () => {
  const runs_of = {
    desertfox: [{ site: "pdf_viewer", checks: { hints: { status: "fail", reason: "no labels | none" } } }],
    vimium: [
      { site: "pdf_viewer", checks: { hints: { status: "fail", reason: "no labels" } } },
      { site: "pdf_viewer", checks: { hints: { status: "error", reason: "long job timeout" } }, retried: true },
      { site: "pdf_viewer", checks: { hints: { status: "pass", reason: "2 labels" } } },
      { site: "pdf_viewer", checks: { hints: { status: "pass", reason: "3 labels" } } },
    ],
  };
  const markdown = sites_table(runs_of, ["desertfox", "vimium"]);
  // The retried run takes no part, so vimium has 2 passes of 3.
  assert.match(markdown, /\| pdf_viewer \| hints \| fail: no labels \\\| none \| pass 2\/3: 2 labels \|/);
  assert.match(markdown, /- pdf_viewer: Firefox runs no extension content script/);
});

test("every site has a unique name and one address, and every tool binds the generic keys", () => {
  const names = SITES.map((site: { name: string }) => site.name);
  assert.equal(new Set(names).size, names.length);
  for (const site of SITES) assert.ok(Boolean(site.url) !== Boolean(site.path), site.name);
  for (const keys of Object.values(TOOL_KEYS) as { scroll_down: string; hint: string }[]) assert.ok(keys.scroll_down && keys.hint);
});

test("frame mode is read from the badge, and recorded as information after the leave step", () => {
  assert.equal(is_frame_mode("FRAME"), true);
  assert.equal(is_frame_mode("NORMAL"), false);
  assert.equal(is_frame_mode(null), false);
  const read = describe_mode_after_leave({ focus: in_frame_body, badge_label: "FRAME" });
  assert.equal(read.status, "info");
  assert.match(read.reason, /mode frame .*frame mode, the site focused a frame/);
  assert.doesNotMatch(describe_mode_after_leave({ focus: on_page, badge_label: "NORMAL" }).reason, /frame mode/);
});

test("frame hints pass only for labels inside the frame, not on the top page", () => {
  assert.equal(judge_frame_hints({ frame_labels: 3, top_labels: 0 }).status, "pass");
  const top_only = judge_frame_hints({ frame_labels: 0, top_labels: 12 });
  assert.equal(top_only.status, "fail");
  assert.match(top_only.reason, /12 on the top page/);
});

const same_top = { url_before: "https://a.test/x", url_after: "https://a.test/x" };

test("a frame control reacted when the frame saw a click or focus, or the frame went away", () => {
  assert.equal(judge_frame_activation({ reply: { event: "click", tag: "button" }, context_gone: false, ...same_top }).status, "pass");
  assert.equal(judge_frame_activation({ reply: null, context_gone: true, ...same_top }).status, "pass");
  assert.equal(judge_frame_activation({ reply: { event: null, tag: null }, context_gone: false, ...same_top }).status, "fail");
  assert.equal(judge_frame_activation({ reply: null, context_gone: false, ...same_top }).status, "fail");
  // A top-level navigation drops every frame context: that is no dismissal.
  const navigated = judge_frame_activation({ reply: null, context_gone: true, url_before: "https://a.test/x", url_after: "https://a.test/y" });
  assert.equal(navigated.status, "fail");
  assert.match(navigated.reason, /top page navigated/);
  // The frame stays and nothing reacted: a changed badge is no dismissal.
  assert.match(judge_frame_activation({ reply: { event: null, tag: null }, context_gone: false, ...same_top }).reason, /did nothing/);
});

test("gF leaves the frame when the badge stops reading FRAME and the focus is on the top page", () => {
  assert.equal(judge_frame_leave({ mode_after: "NORMAL", focus_after: on_page }).status, "pass");
  assert.equal(judge_frame_leave({ mode_after: "FRAME", focus_after: in_frame_body }).status, "fail");
  // The badge alone is not enough: the focus must also be out of the frame.
  assert.equal(judge_frame_leave({ mode_after: "NORMAL", focus_after: in_frame_body }).status, "fail");
  assert.equal(judge_frame_leave({ mode_after: "NORMAL", focus_after: focus_of(null) }).status, "unknown");
});

test("check names hold the frame checks for DesertFox only, so an error or wall record fills every row", () => {
  const site = { extra: ["jk_clash"] };
  assert.deepEqual(check_names_of(site, "desertfox"), ["mode_on_load", "leave", "frame_leave", "frame_hints", "frame_activate", "jk_clash", "scroll", "hints", "hints_escape", "activate"]);
  assert.deepEqual(check_names_of(site, "vimium"), ["mode_on_load", "leave", "jk_clash", "scroll", "hints", "hints_escape", "activate"]);
});

test("a wrong-target status and an n/a frame row show in the cell, and an n/a majority names itself", () => {
  assert.equal(as_action({ status: "wrong_target", reason: "x" }).status, "wrong_target");
  assert.deepEqual(cell_of([{ status: "pass" }, { status: "n/a" }, { status: "n/a" }]), { text: "n/a 2/3", majority: "n/a" });
  assert.deepEqual(cell_of([{ status: "wrong_target" }, { status: "wrong_target" }, { status: "wrong_target" }]), { text: "wrong_target", majority: "wrong_target" });
  assert.deepEqual(FRAME_ROWS, ["frame_leave", "frame_hints", "frame_activate"]);
});
