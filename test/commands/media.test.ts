import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { apply_count } from "../../src/background/count.ts";
import { DEFAULT_KEYMAP } from "../../src/background/default_keymap.ts";
import type { BoundInvocation } from "../../src/shared/invocation.ts";
import { check_args, parse_command_line } from "../../src/shared/registry/index.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

const media = registry.get("media.act")!;
const lookup = { find: (word: string) => registry.find(word) };

function typed(text: string) {
  const parsed = parse_command_line(lookup, text);
  if (parsed.kind !== "invocation") return { ok: false as const, error: parsed.kind === "error" ? parsed.error : parsed.usage };
  return check_args(media, parsed.invocation.args);
}

test("the line reads an action word and then a value, as the A prompt leaves them", () => {
  assert.deepEqual(typed("media speed 1.5"), { ok: true, args: { action: "speed", value: "1.5" } });
  assert.deepEqual(typed("media speed up"), { ok: true, args: { action: "speed", value: "up", times: 1 } });
  assert.deepEqual(typed("media volume 60"), { ok: true, args: { action: "volume", value: "60" } });
  assert.deepEqual(typed("media seek +10"), { ok: true, args: { action: "seek", value: "+10" } });
  assert.deepEqual(typed("media seek -10"), { ok: true, args: { action: "seek", value: "-10" } });
  assert.deepEqual(typed("media speed"), { ok: true, args: { action: "speed" } });
  assert.deepEqual(typed("media pip"), { ok: true, args: { action: "pip" } });
});

test("the schema refuses a value an action cannot take, an unknown action and a bad value", () => {
  assert.equal(typed("media pip 3").ok, false);
  assert.equal(typed("media play_pause up").ok, false);
  assert.match((typed("media rewind") as { error: string }).error, /action expects one of play_pause, speed, volume, seek, pip/);
  assert.match((typed("media speed fast") as { error: string }).error, /value expects text matching/);
  assert.equal((typed("media") as { missing_param?: string }).missing_param, "action");
});

test("a count multiplies an up or down step and is refused on every other key of the group", () => {
  const counted = (args: Record<string, unknown>) => check_args(media, apply_count(media, { id: "media.act", args, count: 3 }).args);
  assert.deepEqual(counted({ action: "speed", value: "up" }), { ok: true, args: { action: "speed", value: "up", times: 3 } });
  assert.deepEqual(counted({ action: "seek", value: "down" }), { ok: true, args: { action: "seek", value: "down", times: 3 } });
  for (const args of [{ action: "play_pause" }, { action: "speed", value: "reset" }, { action: "pip" }, { action: "volume", value: "60" }]) {
    assert.equal(counted(args).ok, false, JSON.stringify(args));
  }
});

test("every key of the a group passes the schema, and A opens the line on the media command", () => {
  const group = Object.entries(DEFAULT_KEYMAP.normal ?? {}).filter(([key]) => /^a.$/.test(key));
  assert.deepEqual(group.map(([key]) => key).sort(), ["aP", "aS", "aV", "ah", "al", "am", "ap", "ar", "as", "av"].sort());
  for (const [key, binding] of group) {
    const step = binding as BoundInvocation;
    assert.equal(check_args(registry.get(step.id)!, step.args).ok, true, key);
  }
  assert.deepEqual(DEFAULT_KEYMAP.normal?.A, { id: "cmdline.open", args: { text: "media " }, label: "Media command" });
  assert.equal(DEFAULT_KEYMAP.group_names?.a, "Media");
});
