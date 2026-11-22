import assert from "node:assert/strict";
import { test } from "node:test";
import { create_settings_boxes, SETTINGS_BOXES } from "../src/help/settings_boxes.ts";
import { BOX_CLASS } from "../src/help/settings_view.ts";
import type { BoxDeps, BoxHandle, SettingsBox } from "../src/help/settings_boxes.ts";
import type { UserCssHold } from "../src/help/user_css_gate.ts";
import type { HelpModel } from "../src/help/model.ts";
import type { Route } from "../src/shared/page/help_route.ts";

const settings_route = { page: "settings" } as Route;
const home_route = { page: "home" } as Route;
const model = {} as HelpModel;

test("the table lists each box class once, in mount order", () => {
  assert.deepEqual(
    SETTINGS_BOXES.map((entry) => entry.box_class),
    [BOX_CLASS.settings, BOX_CLASS.site_keys, BOX_CLASS.keys, BOX_CLASS.engines, BOX_CLASS.aliases, BOX_CLASS.quickmarks, BOX_CLASS.themes, BOX_CLASS.host_start, BOX_CLASS.transfer, BOX_CLASS.files],
  );
  assert.equal(new Set(Object.values(BOX_CLASS)).size, Object.values(BOX_CLASS).length);
  assert.deepEqual(SETTINGS_BOXES.filter((entry) => entry.hold).map((entry) => entry.box_class), [BOX_CLASS.transfer, BOX_CLASS.files]);
});

function setup() {
  const log: string[] = [];
  const present = new Set<string>();
  (globalThis as { document?: unknown }).document = { querySelector: (selector: string) => (present.has(selector) ? { selector } : null) };
  let holds_opened = 0;
  const deps = {
    open_hold: (): UserCssHold => {
      const id = (holds_opened += 1);
      log.push(`open ${id}`);
      return { set: (held) => log.push(`set ${id} ${held}`), dispose: () => log.push(`dispose ${id}`) };
    },
  } as unknown as BoxDeps;
  const entry = (name: string, hold: boolean, handle?: BoxHandle): SettingsBox => ({
    box_class: `box-${name}`,
    ...(hold ? { hold: true as const } : {}),
    mount: (_box, context) => {
      log.push(`mount ${name}`);
      if (hold) context.hold.set(true);
      return handle;
    },
  });
  return { log, present, deps, entry };
}

test("a render stops the old handles, mounts in table order and takes a fresh hold for each hold entry", () => {
  const { log, present, deps, entry } = setup();
  for (const name of ["a", "b", "c", "d"]) present.add(`.box-${name}`);
  const boxes = create_settings_boxes(deps, [
    entry("a", false, { stop: () => log.push("stop a") }),
    entry("b", false, { stop: () => log.push("stop b") }),
    entry("c", true),
    entry("d", true),
  ]);
  boxes.mount_all(settings_route, model, []);
  assert.deepEqual(log, ["mount a", "mount b", "open 1", "mount c", "set 1 true", "open 2", "mount d", "set 2 true"]);
  log.length = 0;
  boxes.stop_all();
  assert.deepEqual(log, ["stop a", "stop b"], "the holds outlive the stop, so a consent view stays held until the next render replaces it");
  log.length = 0;
  boxes.stop_all();
  assert.deepEqual(log, [], "a handle stops once");
  boxes.mount_all(settings_route, model, []);
  assert.deepEqual(log, ["mount a", "mount b", "dispose 1", "open 3", "mount c", "set 3 true", "dispose 2", "open 4", "mount d", "set 4 true"]);
});

test("a route with no Settings page still replaces the holds and mounts nothing", () => {
  const { log, present, deps, entry } = setup();
  present.add(".box-a");
  present.add(".box-c");
  const boxes = create_settings_boxes(deps, [entry("a", false), entry("c", true)]);
  boxes.mount_all(settings_route, model, []);
  log.length = 0;
  boxes.stop_all();
  boxes.mount_all(home_route, model, []);
  assert.deepEqual(log, ["dispose 1", "open 2"]);
});

test("a settings page without a box skips its mount but still replaces its hold", () => {
  const { log, deps, entry } = setup();
  const boxes = create_settings_boxes(deps, [entry("a", false), entry("c", true)]);
  boxes.mount_all(settings_route, model, []);
  assert.deepEqual(log, ["open 1"]);
});

test("redraw runs once at mount and again on request, and set_site reaches the handle that takes it", () => {
  const { log, present, deps, entry } = setup();
  present.add(".box-a");
  present.add(".box-b");
  const boxes = create_settings_boxes(deps, [entry("a", false, { redraw: () => log.push("redraw a") }), entry("b", false, { set_site: (site) => log.push(`site ${site}`) })]);
  boxes.mount_all(settings_route, model, []);
  boxes.redraw();
  boxes.set_site("example.com");
  assert.deepEqual(log.filter((line) => !line.startsWith("mount")), ["redraw a", "redraw a", "site example.com"]);
  boxes.stop_all();
  boxes.redraw();
  boxes.set_site("gone.example");
  assert.equal(log.length, 5, "after the stop no handle is left to call");
});
