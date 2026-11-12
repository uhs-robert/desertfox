import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { DEFAULT_KEYMAP } from "../../src/background/default_keymap.ts";
import { check_args, create_registry, DefineError, parse_command_line, print_command } from "../../src/shared/registry/index.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import type { CommandInput } from "../../src/shared/registry/index.ts";

const hint = registry.get("hint.run")!;

function input_with(params: unknown[]): CommandInput {
  return { name: "demo", label: "Demo", intent: "Do a thing.", runs_in: "background", run: () => {}, params: params as never };
}
const action = (extra: Record<string, unknown>) => ({ name: "action", type: "enum", values: ["here", "tab", "copy"], ...extra });
const filter = { name: "filter", type: "enum", values: ["links", "buttons", "images"], default: "links" };

test("an explicit or default value is refused when its sibling does not allow it", () => {
  assert.equal(check_args(hint, { action: "background", filter: "buttons" }).ok, false);
  assert.equal(check_args(hint, { action: "background", filter: "links" }).ok, true);
  assert.equal(check_args(hint, { action: "mute" }).ok, false);
  assert.equal(check_args(hint, { action: "mute", filter: "media" }).ok, true);
  const result = check_args(hint, { action: "copy", filter: "prose" });
  assert.equal(result.ok ? "" : result.error, "action copy needs filter all, clickable, links, images, frames, media or custom");
});

test("frames defaults to same_origin and prints nothing, so a binding without it runs today's single-frame path", () => {
  const checked = check_args(hint, { action: "copy", filter: "links" });
  assert.equal(checked.ok && checked.args.frames, "same_origin");
  assert.equal(print_command(hint, { action: "copy", filter: "links", frames: "same_origin" }), "hint -y -l");
  assert.equal(print_command(hint, { filter: "links", frames: "all_frames" }), "hint -l --all-frames");
});

test("all_frames is typed as its own flag or through --frames=, and --frames alone stays the frames filter", () => {
  const parsed = (text: string) => {
    const result = parse_command_line(registry, text);
    return result.kind === "invocation" ? result.invocation.args : result;
  };
  assert.deepEqual(parsed("hint --all-frames"), { frames: "all_frames" });
  assert.deepEqual(parsed("hint --frames=all_frames"), { frames: "all_frames" });
  assert.deepEqual(parsed("hint --frames"), { filter: "frames" });
  assert.equal(check_args(hint, { frames: "all" }).ok, false);
});

test("inspect is refused across frames, because the devtools eval runs in the top window", () => {
  const result = check_args(hint, { action: "inspect", filter: "every", frames: "all_frames" });
  assert.equal(result.ok ? "" : result.error, "action inspect needs frames same_origin");
  assert.equal(check_args(hint, { action: "inspect", filter: "every" }).ok, true);
  for (const action of ["here", "tab", "copy", "copy_html", "hover", "double_click", "focus", "prompt"]) assert.equal(check_args(hint, { action, filter: "all", frames: "all_frames" }).ok, true, action);
});

test("caret and visual run across frames, because the owner frame starts the mode, and enter_media stays refused", () => {
  for (const action of ["caret", "visual"] as const) assert.equal(check_args(hint, { action, filter: "prose", frames: "all_frames" }).ok, true, action);
  const result = check_args(hint, { action: "enter_media", filter: "media", frames: "all_frames" });
  assert.equal(result.ok ? "" : result.error, "action enter_media needs frames same_origin");
  assert.equal(check_args(hint, { action: "enter_media", filter: "media" }).ok, true);
});

test("double_click is refused for the links filter", () => {
  assert.equal(check_args(hint, { action: "double_click", filter: "links" }).ok, false);
  assert.equal(check_args(hint, { action: "double_click", filter: "buttons" }).ok, true);
});

test("a value with no rule is allowed with any sibling value", () => {
  for (const name of ["here", "delete", "focus", "hover", "caret"]) assert.equal(check_args(hint, { action: name, filter: "buttons" }).ok, true, name);
});

test("every default keybinding of hint.run passes", () => {
  const hint_bindings = Object.entries(DEFAULT_KEYMAP.normal ?? {}).filter(([, binding]) => (binding as { id?: string }).id === "hint.run");
  assert.ok(hint_bindings.length > 10);
  for (const [key, binding] of hint_bindings) {
    const entry = binding as { args?: Record<string, unknown> };
    const result = check_args(hint, entry.args);
    assert.equal(result.ok, true, `${key}: ${result.ok ? "" : result.error}`);
  }
});

test("define refuses a bad value_when", () => {
  const define = (params: unknown[]) => create_registry().define("demo.run", input_with(params));
  assert.throws(() => define([action({ default: "here", value_when: { nope: { filter: ["links"] } } }), filter]), DefineError);
  assert.throws(() => define([action({ default: "here", value_when: { tab: { missing: ["links"] } } }), filter]), DefineError);
  assert.throws(() => define([action({ default: "here", value_when: { tab: { action: ["here"] } } }), filter]), DefineError);
  assert.throws(() => define([action({ default: "here", value_when: { tab: { filter: ["bogus"] } } }), filter]), DefineError);
  assert.doesNotThrow(() => define([action({ default: "here", value_when: { tab: { filter: ["links"] } } }), filter]));
});

test("define refuses a default arm that its own value rule forbids", () => {
  const define = (arm_filters: string[]) => create_registry().define("demo.run", input_with([
    action({ default: [{ value: "tab", when: { filter: arm_filters } }, "here"], value_when: { tab: { filter: ["links", "images"] } } }),
    filter,
  ]));
  assert.doesNotThrow(() => define(["images"]));
  assert.throws(() => define(["images", "buttons"]), /refused by value_when/);
});

test("define refuses a plain default that its own rule forbids", () => {
  const define = (plain: string, allowed: string[]) => create_registry().define("demo.run", input_with([
    action({ default: plain, value_when: { tab: { filter: allowed } } }),
    filter,
  ]));
  assert.doesNotThrow(() => define("here", ["links"]));
  assert.throws(() => define("tab", ["links", "images"]), /refused by value_when/);
  assert.doesNotThrow(() => define("tab", ["links", "buttons", "images"]));
  const list = (allowed: string[]) => create_registry().define("demo.run", input_with([
    action({ default: [{ value: "copy", when: { filter: ["links"] } }, "tab"], value_when: { tab: { filter: allowed } } }),
    filter,
  ]));
  assert.throws(() => list(["links"]), /refused by value_when/);
});

test("a context source in a rule sibling passes until the router expands it", () => {
  const demo = create_registry().define("demo.run", input_with([
    action({ default: "here", value_when: { tab: { query: ["a"] } } }),
    { name: "query", type: "string", default: "a" },
  ]));
  assert.equal(check_args(demo, { action: "tab", query: { from: "selection" } }).ok, true);
  assert.equal(check_args(demo, { action: "tab", query: "b" }).ok, false);
  assert.equal(check_args(demo, { action: "tab", query: "a" }).ok, true);
});

test("copy_image exists only with the images filter, and download with images, links, media and all", () => {
  for (const name of ["images"]) assert.equal(check_args(hint, { action: "copy_image", filter: name }).ok, true, name);
  for (const name of ["all", "links", "media", "buttons", "frames", "clickable"]) assert.equal(check_args(hint, { action: "copy_image", filter: name }).ok, false, name);
  for (const name of ["images", "links", "media", "all"]) assert.equal(check_args(hint, { action: "download", filter: name }).ok, true, name);
  for (const name of ["buttons", "inputs", "prose", "frames", "clickable"]) assert.equal(check_args(hint, { action: "download", filter: name }).ok, false, name);
});

test("prompt needs a filter with an address, and its command takes a command name and flags only", () => {
  assert.equal(check_args(hint, { action: "prompt", filter: "links" }).ok, true);
  assert.equal(check_args(hint, { action: "prompt", filter: "buttons" }).ok, false);
  assert.equal(check_args(hint, { action: "prompt", filter: "links", command: "open --tab" }).ok, true);
  assert.equal(check_args(hint, { action: "prompt", filter: "links", command: "open -t -c" }).ok, true);
  for (const command of ["open | x", "open; x", "open 'x'", "Open", "open $(x)", "open\nx", "open --tab=x", ""]) assert.equal(check_args(hint, { action: "prompt", filter: "links", command }).ok, false, command);
  assert.equal(check_args(hint, { action: "copy", filter: "links", command: "open" }).ok, false);
});
