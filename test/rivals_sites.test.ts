import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error The rig is plain JavaScript without types.
import { as_action, cell_of, describe_mode_on_load, judge_activation, judge_leave, judge_cell_move, judge_escape, judge_hints, judge_jk_clash, judge_play_pause, judge_scroll, judge_volume, page_wall, pick_activation, sites_table, SITES, TOOL_KEYS } from "../tools/measure/rivals/sites.mjs";

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

test("a scroll of the window or of any element passes, no movement fails and names the focus", () => {
  assert.equal(judge_scroll({ window_dy: 50, element_dy: 0, element: "none", active: "body" }).status, "pass");
  assert.equal(judge_scroll({ window_dy: 0, element_dy: -40, element: "div#main", active: "body" }).status, "pass");
  const stuck = judge_scroll({ window_dy: 0, element_dy: 0, element: "none", active: "input#search" });
  assert.equal(stuck.status, "fail");
  assert.match(stuck.reason, /input#search/);
});

test("hints pass when a label sits on a visible target and fail with no label or only stray labels", () => {
  const targets = [target("0", 100), target("1", 200)];
  assert.equal(judge_hints([label("a", 20, 100)], targets).status, "pass");
  assert.equal(judge_hints([], targets).status, "fail");
  assert.equal(judge_hints([label("a", 600, 600)], targets).status, "fail");
});

test("the activation label is the first with exactly one target near it, typed in lower case, with the label's center", () => {
  const crowded = [target("0", 100), target("1", 135), target("2", 300)];
  assert.deepEqual(pick_activation([label("AB", 20, 125), label("CD", 20, 300)], crowded), { keys: "cd", target: "2", at: { x: 26, y: 308 } });
  assert.equal(pick_activation([label("AB", 600, 600)], crowded), null);
});

test("with no lone near target, the label inside exactly one target wins, then a label clearly nearer one target", () => {
  const crowded = [target("0", 100), target("1", 135)];
  assert.equal(pick_activation([label("AB", 20, 136)], crowded)?.target, "1");
  // Touching toolbar buttons side by side: the label sits just outside both, 2 px from one and 14 px from the other.
  const toolbar = [{ name: "left", rect: rect(0, 50, 30, 30) }, { name: "right", rect: rect(30, 50, 30, 30) }];
  assert.equal(pick_activation([{ text: "x", rect: rect(10, 20, 12, 16) }], toolbar)?.target, "left");
  // A toolbar that is a target itself and holds the button: the button, the innermost, wins.
  const nested = [{ name: "bar", rect: rect(0, 0, 1000, 60) }, { name: "button", rect: rect(8, 7, 48, 48) }];
  assert.equal(pick_activation([{ text: "d", rect: rect(3, 1, 12, 16) }], nested)?.target, "button");
  // A link and its child with one box count as one target.
  assert.equal(pick_activation([{ text: "e", rect: rect(10, 10, 12, 16) }], [{ name: "link", rect: rect(0, 0, 80, 30) }, { name: "child", rect: rect(0, 0, 80, 30) }])?.target, "link");
  // Halfway between the two: neither is clearly nearer.
  assert.equal(pick_activation([{ text: "x", rect: rect(24, 20, 12, 16) }], toolbar), null);
});

test("activation passes on the labelled target or a navigation and fails on another element or nothing", () => {
  assert.equal(judge_activation({ event: "click", on_target: true, tag: "a" }).status, "pass");
  assert.equal(judge_activation({ event: "navigated" }).status, "pass");
  assert.equal(judge_activation({ event: "focus", on_target: false, tag: "button" }).status, "fail");
  assert.equal(judge_activation({ event: "click", on_target: false, under_label: true, tag: "yt-interaction" }).status, "pass");
  assert.equal(judge_activation({ event: null }).status, "fail");
});

const in_frame_field = { path: "iframe.docs > div", takes_typing: true, cross_origin: false };
const on_page = { path: "body", takes_typing: false, cross_origin: false };

test("the mode on load is information: read for DesertFox, inferred from the probe key for the others", () => {
  const read = describe_mode_on_load({ focus: in_frame_field, probe: null, desertfox_mode: "INSERT" });
  assert.equal(read.status, "info");
  assert.match(read.reason, /iframe\.docs > div \(takes typing\); mode insert \(read from the mode badge\)/);
  assert.match(describe_mode_on_load({ focus: in_frame_field, probe: { reached: true, prevented: false }, desertfox_mode: null }).reason, /inferred insert or passing keys/);
  assert.match(describe_mode_on_load({ focus: on_page, probe: { reached: false, prevented: false }, desertfox_mode: null }).reason, /inferred normal/);
  assert.match(describe_mode_on_load({ focus: on_page, probe: { reached: true, prevented: true }, desertfox_mode: null }).reason, /inferred normal/);
  assert.match(describe_mode_on_load({ focus: { path: "iframe > (frame of another origin)", takes_typing: true, cross_origin: true }, probe: null, desertfox_mode: null }).reason, /mode unknown: the focused frame is of another origin/);
});

test("the leave key passes when the focus leaves the field, also from inside a frame, and fails when it stays", () => {
  assert.equal(judge_leave({ before: in_frame_field, after: on_page }).status, "pass");
  assert.equal(judge_leave({ before: on_page, after: on_page }).status, "pass");
  const stuck = judge_leave({ before: in_frame_field, after: in_frame_field });
  assert.equal(stuck.status, "fail");
  assert.match(stuck.reason, /stayed in iframe\.docs > div/);
});

test("a normal-mode action that did not happen is blocked, and a pass stays a pass", () => {
  assert.equal(as_action({ status: "fail", reason: "no labels" }).status, "blocked");
  assert.equal(as_action({ status: "pass", reason: "ok" }).status, "pass");
  assert.equal(as_action({ status: "error", reason: "timeout" }).status, "error");
});

test("escape passes only when no label is left", () => {
  assert.equal(judge_escape(0).status, "pass");
  assert.equal(judge_escape(3).status, "fail");
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

test("a cell shows one status when the runs agree and each status when they differ", () => {
  assert.equal(cell_of([{ status: "pass" }, { status: "pass" }]), "pass");
  assert.equal(cell_of([{ status: "pass" }, { status: "fail" }]), "pass/fail");
  assert.equal(cell_of([]), "-");
});

test("the table has a row per site and check, with the reason when the runs agree, and the site notes below", () => {
  const runs_of = {
    desertfox: [{ site: "pdf_viewer", checks: { hints: { status: "fail", reason: "no labels | none" } } }],
    vimium: [{ site: "pdf_viewer", checks: { hints: { status: "fail", reason: "no labels" } } }, { site: "pdf_viewer", checks: { hints: { status: "pass", reason: "2 labels" } } }],
  };
  const markdown = sites_table(runs_of, ["desertfox", "vimium"]);
  assert.match(markdown, /\| pdf_viewer \| hints \| fail: no labels \\\| none \| fail\/pass \|/);
  assert.match(markdown, /- pdf_viewer: Firefox runs no extension content script/);
});

test("every site has a unique name and one address, and every tool binds the generic keys", () => {
  const names = SITES.map((site: { name: string }) => site.name);
  assert.equal(new Set(names).size, names.length);
  for (const site of SITES) assert.ok(Boolean(site.url) !== Boolean(site.path), site.name);
  for (const keys of Object.values(TOOL_KEYS) as { scroll_down: string; hint: string }[]) assert.ok(keys.scroll_down && keys.hint);
});
