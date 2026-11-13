import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error The rig is plain JavaScript without types.
import { analyze_tab_switch, NEXT_TAB_KEY, RETRY_MS } from "../tools/measure/rivals/tab_timing.mjs";

test("times both hops from one clock and counts the presses sent before the landing", () => {
  const result = analyze_tab_switch({
    key_a_ms: 100,
    selects: [{ index: 1, ms: 130 }, { index: 2, ms: 190 }],
    presses_b_ms: [131, 141, 151, 161, 171, 181],
  });
  assert.equal(result.first_hop_ms, 30);
  assert.equal(result.arrive_to_land_ms, 60);
  assert.equal(result.presses_sent, 6);
  assert.equal(result.lost_before_landing, 5);
  assert.equal(result.extra_hops, 0);
});

test("a press in flight that works after the landing is an extra hop and not a lost press", () => {
  const result = analyze_tab_switch({ key_a_ms: 0, selects: [{ index: 1, ms: 10 }, { index: 2, ms: 40 }, { index: 0, ms: 52 }], presses_b_ms: [11, 21, 31] });
  assert.equal(result.extra_hops, 1);
  assert.equal(result.lost_before_landing, 2);
});

test("a first press that works is no lost press", () => {
  const result = analyze_tab_switch({ key_a_ms: 0, selects: [{ index: 1, ms: 5 }, { index: 2, ms: 20 }], presses_b_ms: [6] });
  assert.equal(result.lost_before_landing, 0);
});

test("a switch to the wrong tab or before the key does not count as a hop", () => {
  assert.match(analyze_tab_switch({ key_a_ms: 50, selects: [{ index: 1, ms: 40 }, { index: 2, ms: 90 }], presses_b_ms: [] }).error, /did not switch/);
  assert.match(analyze_tab_switch({ key_a_ms: 0, selects: [{ index: 1, ms: 10 }, { index: 0, ms: 30 }], presses_b_ms: [11, 21] }).error, /no press/);
});

test("every tool has a next-tab key and the retry gap is positive", () => {
  assert.deepEqual(Object.keys(NEXT_TAB_KEY).sort(), ["desertfox", "tridactyl", "vimium", "vimiumc"]);
  assert.ok(RETRY_MS > 0);
});

test("a first switch to the wrong tab fails even when the right tabs follow", () => {
  const result = analyze_tab_switch({ key_a_ms: 0, selects: [{ index: 2, ms: 10 }, { index: 1, ms: 20 }, { index: 2, ms: 60 }], presses_b_ms: [21, 31, 41, 51] });
  assert.match(result.error, /did not switch/);
});

test("the median gap between presses is reported from the press times", () => {
  const result = analyze_tab_switch({ key_a_ms: 0, selects: [{ index: 1, ms: 10 }, { index: 2, ms: 80 }], presses_b_ms: [11, 28, 45, 62] });
  assert.equal(result.press_gap_ms, 17);
});

test("an even number of gaps reports the mean of the two middle gaps", () => {
  const result = analyze_tab_switch({ key_a_ms: 0, selects: [{ index: 1, ms: 10 }, { index: 2, ms: 60 }], presses_b_ms: [11, 21, 51] });
  assert.equal(result.press_gap_ms, 20);
});
