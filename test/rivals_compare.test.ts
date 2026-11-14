import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
// @ts-expect-error The rig is plain JavaScript without types.
import { owns_profile, pick_close_targets, profile_dir_of, read_state, state_file_of, write_state } from "../tools/measure/rivals/compare.mjs";

const window_of = (dir: string, tool: string, pid: number, start_ticks: number) => ({ tool, pid, start_ticks, port: 40000 + pid, profile: profile_dir_of(dir, tool) });

test("the state file round-trips, and a missing file is an empty list", () => {
  const dir = mkdtempSync(join(tmpdir(), "compare-state-"));
  try {
    assert.deepEqual(read_state(dir), []);
    const windows = [window_of(dir, "desertfox", 100, 5000), window_of(dir, "vimium", 101, 5001)];
    write_state(dir, windows);
    assert.deepEqual(read_state(dir), windows);
    assert.equal(statSync(state_file_of(dir)).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a damaged state file or an unknown tool throws instead of guessing", () => {
  const dir = mkdtempSync(join(tmpdir(), "compare-state-"));
  try {
    writeFileSync(state_file_of(dir), "{not json");
    assert.throws(() => read_state(dir));
    writeFileSync(state_file_of(dir), JSON.stringify({ windows: [{ tool: "firefox", pid: 1, start_ticks: 1, port: 1, profile: "/home" }] }));
    assert.throws(() => read_state(dir), /not a compare state file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("close targets are the recorded pids whose start ticks still match", () => {
  const dir = "/c";
  const windows = [
    window_of(dir, "desertfox", 100, 5000),
    window_of(dir, "vimium", 101, 5001),
    window_of(dir, "vimiumc", 102, 5002),
    window_of(dir, "tridactyl", 0, 0),
  ];
  const live: Record<number, number> = { 100: 5000, 101: 9999 };
  const { running, gone } = pick_close_targets(windows, (pid: number) => live[pid] ?? null);
  assert.deepEqual(running.map((w: { tool: string }) => w.tool), ["desertfox"]);
  assert.deepEqual(gone.map((w: { tool: string }) => w.tool), ["vimium", "vimiumc", "tridactyl"]);
});

test("a profile is deleted only at the path made for its tool", () => {
  assert.equal(owns_profile("/c", window_of("/c", "vimium", 1, 1)), true);
  assert.equal(owns_profile("/c", { ...window_of("/c", "vimium", 1, 1), profile: "/home/user/.mozilla" }), false);
});
