import assert from "node:assert/strict";
import { test } from "node:test";
import { create_host_start_session } from "../src/help/host_start_model.ts";
import type { HostStartChoice, HostStartPending } from "../src/shared/messages.ts";

const pending: HostStartPending = { config_dir: "/c", host_digest: "h1", browser_digest: "b1", changes: [{ path: "settings.toml", kind: "replaced" }] };

function session_with(stored: { value: unknown }, answer_of: (message: HostStartChoice) => unknown) {
  const sent: HostStartChoice[] = [];
  const session = create_host_start_session({
    read_pending: async () => stored.value,
    send: async (message) => {
      sent.push(message);
      return answer_of(message);
    },
    on_change: () => undefined,
  });
  return { session, sent };
}

test("the banner shows a stored question and nothing for a record that does not fit", async () => {
  const stored = { value: pending as unknown };
  const { session } = session_with(stored, () => undefined);
  await session.load();
  assert.deepEqual(session.state.pending, pending);
  for (const bad of [undefined, "x", { ...pending, host_digest: 1 }, { ...pending, changes: [{ path: "a", kind: "moved" }] }]) {
    stored.value = bad;
    await session.load();
    assert.equal(session.state.pending, undefined);
  }
});

test("a choice sends the digests the banner showed, and the answer and the fresh question replace the old ones", async () => {
  const stored = { value: pending as unknown };
  const refreshed = { ...pending, host_digest: "h2" };
  const { session, sent } = session_with(stored, () => {
    stored.value = refreshed;
    return { ok: false, message: "changed since" };
  });
  await session.load();
  await session.choose("use_folder");
  assert.deepEqual(sent, [{ type: "host_start_choice", choice: "use_folder", host_digest: "h1", browser_digest: "b1" }]);
  assert.deepEqual(session.state.message, { ok: false, text: "changed since" });
  assert.deepEqual(session.state.pending, refreshed);
  assert.equal(session.state.busy, false);
});

test("a refused folder lists every problem, a settled question leaves only the message, and a second click while busy sends nothing", async () => {
  const stored = { value: pending as unknown };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { session, sent } = session_with(stored, async () => {
    await gate;
    return { ok: false, message: "does not build", problems: ["a", "b", "c", "d"] };
  });
  await session.load();
  const first = session.choose("use_folder");
  await session.choose("keep_browser");
  release();
  await first;
  assert.equal(sent.length, 1);
  assert.deepEqual(session.state.problems, ["a", "b", "c", "d"]);
  stored.value = undefined;
  await session.load();
  assert.equal(session.state.pending, undefined);
  assert.equal(session.state.message?.text, "does not build");
});

test("a send that throws becomes a message, not an unhandled rejection", async () => {
  const { session } = session_with({ value: pending }, () => Promise.reject(new Error("no background")));
  await session.load();
  await session.choose("keep_browser");
  assert.deepEqual(session.state.message, { ok: false, text: "no background" });
});
