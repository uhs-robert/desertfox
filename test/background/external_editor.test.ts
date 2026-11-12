import assert from "node:assert/strict";
import { test } from "node:test";
import { create_external_editor } from "../../src/background/external_editor.ts";
import type { EditorCollectReply } from "../../src/background/native_client.ts";
import { NativeHostError } from "../../src/background/native_client.ts";
import type { EditorDone, EditorOpen } from "../../src/shared/messages.ts";

const request = (token = "t1"): EditorOpen => ({ type: "editor_open", token, text: "hello", insert: false });
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

function make(collect: (job: string) => Promise<EditorCollectReply>, options: { store?: Record<string, unknown>; start?: () => Promise<string>; tabs?: number[] } = {}) {
  const store = options.store ?? {};
  const log = { starts: [] as object[], done: [] as { tab_id: number; frame_id: number; message: EditorDone }[], toasts: [] as string[], collects: 0 };
  let count = 0;
  const editor = create_external_editor({
    session: { get: async (key) => ({ [key as string]: store[key as string] }), set: async (items) => void Object.assign(store, items) },
    client: {
      editor_start: async (body) => (log.starts.push(body), options.start ? options.start() : `job${++count}`),
      editor_collect: (job) => (log.collects++, collect(job)),
    },
    send_done: async (tab_id, frame_id, message) => void log.done.push({ tab_id, frame_id, message }),
    toast: async (_tab, _frame, message) => void log.toasts.push(message),
    tab_exists: async (tab_id) => (options.tabs ?? [1]).includes(tab_id),
  });
  return { editor, log, store };
}

test("a start sends text, ext and insert, then the loop keeps polling while pending and hands the text to the frame", async () => {
  let polls = 0;
  const { editor, log, store } = make(async () => (++polls < 3 ? { pending: true } : { done: true, changed: true, text: "final" }));
  assert.deepEqual(await editor.open(1, 4, { ...request(), insert: true }, "md"), { ok: true });
  await settle();
  assert.deepEqual(log.starts, [{ text: "hello", ext: "md", insert: true }]);
  assert.equal(polls, 3);
  assert.deepEqual(log.done, [{ tab_id: 1, frame_id: 4, message: { type: "editor_done", token: "t1", text: "final" } }]);
  assert.deepEqual(Object.values(store)[0], {});
});

test("a quit without a save answers done with no text", async () => {
  const { editor, log } = make(async () => ({ done: true, changed: false }));
  await editor.open(1, 0, request(), undefined);
  await settle();
  assert.deepEqual(log.starts, [{ text: "hello" }]);
  assert.deepEqual(log.done[0]?.message, { type: "editor_done", token: "t1" });
});

test("a second press while one editor is open refuses, also when the two presses come at once", async () => {
  const { editor, log } = make(() => new Promise(() => {}));
  const [first, second] = await Promise.all([editor.open(1, 0, request("a"), undefined), editor.open(1, 0, request("b"), undefined)]);
  assert.equal(first.ok, true);
  assert.deepEqual(second, { ok: false, message: "An editor is already open for this tab" });
  assert.equal(log.starts.length, 1);
  assert.equal((await editor.open(2, 0, request("c"), undefined)).ok, true, "another tab has its own job");
});

test("a host refusal at the start comes back as its error and stores no job", async () => {
  const { editor, store } = make(() => new Promise(() => {}), { start: async () => Promise.reject(new NativeHostError("host_failed", "The DesertFox native host refused: no editor.toml")) });
  const answer = await editor.open(1, 0, request(), undefined);
  assert.equal(answer.ok, false);
  assert.match(answer.ok ? "" : answer.message, /no editor\.toml/);
  assert.equal(Object.keys(store).length, 0);
});

test("a collect that fails mid-loop clears the job and toasts the error, and the next press starts again", async () => {
  let fail = true;
  const { editor, log } = make(async () => (fail ? Promise.reject(new NativeHostError("host_failed", "unknown job")) : new Promise<EditorCollectReply>(() => {})));
  await editor.open(1, 2, request(), undefined);
  await settle();
  assert.deepEqual(log.toasts, ["unknown job"]);
  assert.deepEqual(log.done, []);
  fail = false;
  assert.equal((await editor.open(1, 2, request("again"), undefined)).ok, true);
});

test("a tab that navigated or closed drops the job: nothing is sent when the editor ends later", async () => {
  let finish!: (reply: EditorCollectReply) => void;
  const { editor, log } = make(() => new Promise((resolve) => (finish = resolve)));
  await editor.open(1, 0, request(), undefined);
  await editor.forget(1);
  finish({ done: true, changed: true, text: "late" });
  await settle();
  assert.deepEqual(log.done, []);
  assert.deepEqual(log.toasts, []);
  assert.equal((await editor.open(1, 0, request("new"), undefined)).ok, true, "the new page can open one");
});

test("a restarted background resumes the loop from storage and delivers the result", async () => {
  const store: Record<string, unknown> = { desertfox_editor_jobs: { 1: { job: "j9", token: "tok", frame_id: 3 }, 2: { job: "gone", token: "x", frame_id: 0 } } };
  const asked: string[] = [];
  const { editor, log } = make(async (job) => (asked.push(job), { done: true, changed: true, text: "back" }), { store, tabs: [1] });
  await editor.resume();
  await settle();
  assert.deepEqual(asked, ["j9"]);
  assert.deepEqual(log.done, [{ tab_id: 1, frame_id: 3, message: { type: "editor_done", token: "tok", text: "back" } }]);
  assert.deepEqual(store.desertfox_editor_jobs, {}, "the job of the closed tab is dropped too");
});

test("resume does not start a second loop for a job this background already collects", async () => {
  let polls = 0;
  let finish!: (reply: EditorCollectReply) => void;
  const { editor } = make(() => (polls++, new Promise((resolve) => (finish = resolve))));
  await editor.open(1, 0, request(), undefined);
  await settle();
  await editor.resume();
  await settle();
  assert.equal(polls, 1);
  finish({ done: true, changed: false });
});
