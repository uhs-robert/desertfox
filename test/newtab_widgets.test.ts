import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { advance_hands, clock_angles, time_label, unwrap_angle } from "../src/newtab/clock.ts";
import { digital_parts } from "../src/newtab/digital_clock.ts";
import { date_text, enabled_widgets } from "../src/newtab/render.ts";
import { closed_rows, top_site_rows } from "../src/newtab/widgets.ts";
import { effective_settings } from "../src/shared/config.ts";

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
  assert.equal(unwrap_angle(361, 359), 719, "forward only: a step back is the caller's to catch");
});

test("the date reads weekday, month and day, with no year", () => {
  assert.equal(date_text(new Date(2026, 10, 3, 12)), new Date(2026, 10, 3, 12).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }));
  assert.doesNotMatch(date_text(new Date(2026, 10, 3, 12)), /2026/);
});

test("the date text changes across midnight", () => {
  assert.notEqual(date_text(new Date(2026, 10, 3, 23, 59, 59)), date_text(new Date(2026, 10, 4, 0, 0, 0)));
});

test("each widget shows unless its setting is false", () => {
  assert.deepEqual(enabled_widgets(effective_settings({})), { clock: true, clock_style: "analog", date: true });
  assert.deepEqual(enabled_widgets(effective_settings({ newtab_clock: false, newtab_date: false })), { clock: false, clock_style: "analog", date: false });
});

test("the clock is analog for true and analog, and digital only for digital", () => {
  assert.equal(enabled_widgets(effective_settings({ newtab_clock: true })).clock_style, "analog");
  assert.equal(enabled_widgets(effective_settings({ newtab_clock: "analog" })).clock_style, "analog");
  assert.deepEqual(enabled_widgets(effective_settings({ newtab_clock: "digital" })), { clock: true, clock_style: "digital", date: true });
});

test("digital clock, 12 hour: zero-padded hours, midnight and noon read 12, AM and PM follow", () => {
  const at = (hours: number, minutes: number) => digital_parts(new Date(2026, 0, 1, hours, minutes), 12);
  assert.deepEqual(at(0, 5), { digits: "12:05", meridiem: "AM" });
  assert.deepEqual(at(9, 30), { digits: "09:30", meridiem: "AM" });
  assert.deepEqual(at(12, 0), { digits: "12:00", meridiem: "PM" });
  assert.deepEqual(at(15, 7), { digits: "03:07", meridiem: "PM" });
  assert.deepEqual(at(23, 59), { digits: "11:59", meridiem: "PM" });
});

test("digital clock, 24 hour: padded hours from 00 to 23 and no suffix", () => {
  const at = (hours: number, minutes: number) => digital_parts(new Date(2026, 0, 1, hours, minutes), 24);
  assert.deepEqual(at(0, 5), { digits: "00:05", meridiem: "" });
  assert.deepEqual(at(15, 7), { digits: "15:07", meridiem: "" });
  assert.deepEqual(at(23, 59), { digits: "23:59", meridiem: "" });
});

test("advance_hands: a gap or a backward step jumps to the new angles instead of animating", () => {
  const at = (seconds: number) => new Date(2026, 0, 1, 3, 15, seconds);
  const first = advance_hands(null, at(10));
  assert.equal(first.jumped, true);
  const next = advance_hands(first, at(11));
  assert.equal(next.jumped, false);
  assert.equal(next.angles.second, 66);
  const after_sleep = advance_hands(next, new Date(2026, 0, 1, 3, 20, 0));
  assert.equal(after_sleep.jumped, true);
  assert.equal(after_sleep.angles.second, 0, "a jump shows the plain angle, not an accumulated one");
  const stepped_back = advance_hands(next, at(9));
  assert.equal(stepped_back.jumped, true);
  assert.equal(stepped_back.angles.second, 54);
});

test("advance_hands: across a wrap the hands keep turning forward", () => {
  const first = advance_hands(null, new Date(2026, 0, 1, 3, 15, 59));
  const wrapped = advance_hands(first, new Date(2026, 0, 1, 3, 16, 0));
  assert.equal(wrapped.jumped, false);
  assert.equal(wrapped.angles.second, 360);
  assert.equal(wrapped.angles.minute, 16 * 6);
});

test("time_label gives hours and minutes", () => {
  assert.equal(time_label(new Date(2026, 0, 1, 15, 5, 30)), time_label(new Date(2026, 0, 1, 15, 5, 59)));
  assert.notEqual(time_label(new Date(2026, 0, 1, 15, 5, 30)), time_label(new Date(2026, 0, 1, 15, 6, 0)));
});

// A Date whose local fields differ from its elapsed time, as across a daylight-saving change.
const local_clock = (epoch_ms: number, hours: number, minutes: number, seconds: number) =>
  Object.assign(new Date(epoch_ms), { getHours: () => hours, getMinutes: () => minutes, getSeconds: () => seconds });

test("advance_hands: a daylight-saving fall-back jumps instead of sweeping the hour hand", () => {
  const before = advance_hands(null, local_clock(0, 1, 59, 59));
  const after = advance_hands(before, local_clock(1000, 1, 0, 0));
  assert.equal(after.jumped, true);
  assert.equal(after.angles.hour, 30);
});

test("advance_hands: a daylight-saving spring-forward jumps by the hour", () => {
  const before = advance_hands(null, local_clock(0, 1, 59, 59));
  const after = advance_hands(before, local_clock(1000, 3, 0, 0));
  assert.equal(after.jumped, true);
  assert.equal(after.angles.hour, 90);
});

test("advance_hands: a normal tick animates", () => {
  const first = advance_hands(null, new Date(2026, 0, 1, 3, 15, 10));
  assert.equal(advance_hands(first, new Date(2026, 0, 1, 3, 15, 11)).jumped, false);
});

test("advance_hands: the longest animated gap can cross three second boundaries and still animates", () => {
  const first = advance_hands(null, new Date(2026, 0, 1, 3, 15, 10, 900));
  const next = advance_hands(first, new Date(2026, 0, 1, 3, 15, 13, 400));
  assert.equal(next.jumped, false);
  assert.equal(next.angles.second, 13 * 6);
});

test("advance_hands: the minute wrap and the hour wrap animate", () => {
  const minute_wrap = advance_hands(advance_hands(null, new Date(2026, 0, 1, 3, 59, 59)), new Date(2026, 0, 1, 4, 0, 0));
  assert.equal(minute_wrap.jumped, false);
  const hour_wrap = advance_hands(advance_hands(null, new Date(2026, 0, 1, 11, 59, 59)), new Date(2026, 0, 1, 12, 0, 0));
  assert.equal(hour_wrap.jumped, false);
  assert.equal(hour_wrap.angles.hour, 360);
});

test("only the new tab page declares the digital clock font", () => {
  const sources = readdirSync("src", { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && /\.(ts|html|css|json)$/.test(entry.name));
  const naming = sources.filter((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8").includes("DSEG7"));
  assert.deepEqual(naming.map((entry) => entry.name), ["newtab.html"]);
});

test("closed tabs: newest first, web addresses only, capped, none on a private page", () => {
  const sessions = [{ tab: { sessionId: "1", title: "One", url: "https://one.example/a" } }, { tab: { url: "https://nosession.example/" } }, { tab: { sessionId: "3", title: "Three", url: "about:preferences" } }, { tab: { sessionId: "4", title: "Four", url: "https://four.example/" } }];
  const rows = closed_rows(sessions, 8, false);
  assert.deepEqual(rows.map((row) => [row.label, row.session_id, row.host]), [["One", "1", "one.example"], ["Four", "4", "four.example"]]);
  assert.equal(closed_rows(sessions, 1, false).length, 1);
  assert.deepEqual(closed_rows(sessions, 8, true), []);
  assert.deepEqual(closed_rows(sessions, 0, false), []);
});

test("closed tabs: a closed private tab is dropped before the row limit", () => {
  const sessions = [{ tab: { sessionId: "1", title: "Secret", url: "https://secret.example/", incognito: true } }, { tab: { sessionId: "2", title: "Open", url: "https://open.example/", incognito: false } }];
  assert.deepEqual(closed_rows(sessions, 1, false).map((row) => row.session_id), ["2"]);
});

test("top sites: visits add up per host, the best page stands for the site, most visited first", () => {
  const visits = [
    { url: "https://a.example/x", title: "A x", visitCount: 3 },
    { url: "https://www.b.example/", title: "B", visitCount: 5 },
    { url: "https://a.example/y", title: "A y", visitCount: 4 },
    { url: "https://c.example/", title: "C", visitCount: 1 },
    { url: "ftp://d.example/", visitCount: 99 },
  ];
  const rows = top_site_rows(visits, 8, false);
  assert.deepEqual(rows.map((row) => [row.host, row.url, row.label]), [["a.example", "https://a.example/y", "A y"], ["b.example", "https://www.b.example/", "B"], ["c.example", "https://c.example/", "C"]]);
  assert.equal(top_site_rows(visits, 2, false).length, 2);
  assert.deepEqual(top_site_rows(visits, 8, true), []);
});

test("top sites and closed tabs take a cached icon by host", () => {
  const cached = new Map([["a.example", "data:image/png;base64,AA=="]]);
  assert.equal(top_site_rows([{ url: "https://a.example/", visitCount: 1 }], 8, false, cached)[0]?.icon_url, "data:image/png;base64,AA==");
  assert.equal(closed_rows([{ tab: { sessionId: "1", url: "https://z.example/" } }], 8, false, cached)[0]?.icon_url, undefined);
});
