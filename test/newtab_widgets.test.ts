import assert from "node:assert/strict";
import { test } from "node:test";
import { clock_angles, unwrap_angle } from "../src/newtab/clock.ts";
import { date_text, enabled_widgets } from "../src/newtab/render.ts";

test("clock angles: the hour hand turns once per 12 hours", () => {
  const at = (hours: number, minutes: number, seconds: number) => clock_angles(new Date(2026, 0, 1, hours, minutes, seconds));
  assert.deepEqual(at(0, 0, 0), { hour: 0, minute: 0, second: 0 });
  assert.equal(at(12, 0, 0).hour, 0);
  assert.equal(at(18, 0, 0).hour, 180);
  assert.equal(at(6, 30, 0).hour, 195);
  assert.equal(at(15, 0, 0).hour, at(3, 0, 0).hour);
});

test("clock angles: the seconds hand moves 6 degrees a second and the minute hand follows it", () => {
  const angles = clock_angles(new Date(2026, 0, 1, 3, 15, 30));
  assert.equal(angles.second, 180);
  assert.equal(angles.minute, 15.5 * 6);
});

test("unwrap_angle: a hand passes 360 without turning back", () => {
  assert.equal(unwrap_angle(354, 0), 360);
  assert.equal(unwrap_angle(360, 6), 366);
  assert.equal(unwrap_angle(714, 0), 720);
  assert.equal(unwrap_angle(0, 0), 0);
  assert.equal(unwrap_angle(100, 98), 98, "a small step back stays a step back");
});

test("the date reads weekday, month and day, with no year", () => {
  assert.equal(date_text(new Date(2026, 10, 3, 12)), new Date(2026, 10, 3, 12).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }));
  assert.doesNotMatch(date_text(new Date(2026, 10, 3, 12)), /2026/);
});

test("the date text changes across midnight", () => {
  assert.notEqual(date_text(new Date(2026, 10, 3, 23, 59, 59)), date_text(new Date(2026, 10, 4, 0, 0, 0)));
});

test("each widget shows unless its setting is false", () => {
  assert.deepEqual(enabled_widgets({}), { clock: true, date: true });
  assert.deepEqual(enabled_widgets({ newtab_clock: false, newtab_date: false }), { clock: false, date: false });
});
