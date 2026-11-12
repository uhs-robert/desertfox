import assert from "node:assert/strict";
import { test } from "node:test";
import { create_external_editor, make_editor_ext_for } from "../../src/background/external_editor.ts";
import type { EditorCollectReply } from "../../src/background/native_client.ts";
import { NativeHostError } from "../../src/background/native_client.ts";
import { COMPILED_KEYMAP_STORAGE_KEY, COMPILED_KEYMAP_VERSION } from "../../src/shared/prefix_tree.ts";
import type { EditorDone, EditorOpen } from "../../src/shared/messages.ts";

const request = (token = "t1"): EditorOpen => ({ type: "editor_open", token, text: "hello", insert: false });
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const forever = () => new Promise<EditorCollectReply>(() => {});

type Options = { store?: Record<string, unknown>; start?: () => Promise<string>; tabs?: number[]; now?: () => number; pause?: (ms: number) => Promise<void>; delivered?: boolean; save?: () => Promise<void> };

function make(collect: (job: string) => Promise<EditorCollectReply>, options: Options = {}) {
  const store = options.store ?? {};
  const log = { starts: [] as object[], done: [] as { tab_id: number; frame_id: number; message: EditorDone }[], toasts: [] as string[], saved: [] as { text: string; is_private: boolean }[], collects: 0 };
  let count = 0;
  const editor = create_external_editor({
    session: { get: async (key) => ({ [key as string]: store[key as string] }), set: async (items) => void Object.assign(store, items) },
    client: {
      editor_start: async (body) => (log.starts.push(body), options.start ? options.start() : `job${++count}`),
      editor_collect: (job) => (log.collects++, collect(job)),
    },
    send_done: async (tab_id, frame_id, message) => (log.done.push({ tab_id, frame_id, message }), options.delivered ?? true),
    save_text: async (text, is_private) => {
      await options.save?.();
      log.saved.push({ text, is_private });
    },
    toast: async (_tab, _frame, message) => void log.toasts.push(message),
    tab_exists: async (tab_id) => (options.tabs ?? [1]).includes(tab_id),
    now: options.now ?? (() => 0),
    pause: options.pause ?? (async () => {}),
  });
  const open = (tab_id: number, frame_id: number, token = "t1", ext?: string, insert = false) => editor.open(tab_id, frame_id, { ...request(token), insert }, ext, false);
  return { editor, open, log, store };
}

test("a start sends text, ext and insert, then the loop keeps polling while pending and hands the text to the frame", async () => {
  let polls = 0;
  const { open, log, store } = make(async () => (++polls < 3 ? { pending: true } : { done: true, changed: true, text: "final" }));
  assert.deepEqual(await open(1, 4, "t1", "md", true), { ok: true });
  await settle();
  assert.deepEqual(log.starts, [{ text: "hello", ext: "md", insert: true }]);
  assert.equal(polls, 3);
  assert.deepEqual(log.done, [{ tab_id: 1, frame_id: 4, message: { type: "editor_done", token: "t1", text: "final" } }]);
  assert.deepEqual(log.saved, []);
  assert.deepEqual(Object.values(store)[0], {});
});

test("a quit without a save answers done with no text", async () => {
  const { open, log } = make(async () => ({ done: true, changed: false }));
  await open(1, 0);
  await settle();
  assert.deepEqual(log.starts, [{ text: "hello" }]);
  assert.deepEqual(log.done[0]?.message, { type: "editor_done", token: "t1" });
  assert.deepEqual(log.saved, []);
});

test("a second press while one editor is open refuses, also when the two presses come at once", async () => {
  const { open, log } = make(forever);
  const [first, second] = await Promise.all([open(1, 0, "a"), open(1, 0, "b")]);
  assert.equal(first.ok, true);
  assert.deepEqual(second, { ok: false, message: "An editor is already open for this tab" });
  assert.equal(log.starts.length, 1);
  assert.equal((await open(2, 0, "c")).ok, true, "another tab has its own job");
});

test("a host refusal at the start comes back as its error and stores no job", async () => {
  const { open, store } = make(forever, { start: async () => Promise.reject(new NativeHostError("host_failed", "The DesertFox native host refused: no editor.toml")) });
  const answer = await open(1, 0);
  assert.equal(answer.ok, false);
  assert.match(answer.ok ? "" : answer.message, /no editor\.toml/);
  assert.equal(Object.keys(store).length, 0);
});

test("a collect that fails mid-loop clears the job and toasts the error, and the next press starts again", async () => {
  let fail = true;
  const { open, log } = make(() => (fail ? Promise.reject(new NativeHostError("host_failed", "unknown job")) : forever()));
  await open(1, 2);
  await settle();
  assert.deepEqual(log.toasts, ["unknown job"]);
  assert.deepEqual(log.done, []);
  fail = false;
  assert.equal((await open(1, 2, "again")).ok, true);
});

test("a tab that navigated keeps collecting, and the late result goes to the register, not to the new page", async () => {
  const finish = new Map<string, (reply: EditorCollectReply) => void>();
  const { editor, open, log } = make((job) => new Promise((resolve) => finish.set(job, resolve)));
  await open(1, 0);
  await editor.orphan(1);
  assert.equal((await open(1, 0, "new")).ok, true, "the new page can open its own editor");
  finish.get("job1")!({ done: true, changed: true, text: "late" });
  await settle();
  assert.deepEqual(log.done, []);
  assert.deepEqual(log.saved, [{ text: "late", is_private: false }]);
  assert.match(log.toasts[0] ?? "", /unnamed register/);
});

test("an orphaned job whose editor ended without a save saves nothing", async () => {
  let finish!: (reply: EditorCollectReply) => void;
  const { editor, open, log } = make(() => new Promise((resolve) => (finish = resolve)));
  await open(1, 0);
  await editor.orphan(1);
  finish({ done: true, changed: false });
  await settle();
  assert.deepEqual([log.done, log.saved, log.toasts], [[], [], []]);
});

test("a page that does not take the result (a subframe that navigated) sends the text to the register", async () => {
  const { open, log } = make(async () => ({ done: true, changed: true, text: "saved" }), { delivered: false });
  await open(1, 3);
  await settle();
  assert.equal(log.done.length, 1);
  assert.deepEqual(log.saved, [{ text: "saved", is_private: false }]);
  assert.match(log.toasts[0] ?? "", /unnamed register/);
});

test("a register that refuses the text is said in the toast with the text length", async () => {
  const { open, log } = make(async () => ({ done: true, changed: true, text: "saved" }), { delivered: false, save: async () => Promise.reject(new Error("storage full")) });
  await open(1, 3);
  await settle();
  assert.deepEqual(log.saved, []);
  assert.match(log.toasts[0] ?? "", /5 characters.*storage full/);
});

test("a private tab's text goes to the private register", async () => {
  const { editor, log } = make(async () => ({ done: true, changed: true, text: "x" }), { delivered: false });
  await editor.open(1, 0, request(), undefined, true);
  await settle();
  assert.deepEqual(log.saved, [{ text: "x", is_private: true }]);
});

test("a restarted background resumes every job from storage, and a tab that is gone is orphaned first", async () => {
  const store: Record<string, unknown> = {
    desertfox_editor_jobs: {
      j9: { job: "j9", tab_id: 1, token: "tok", frame_id: 3, is_private: false },
      gone: { job: "gone", tab_id: 2, token: "x", frame_id: 0, is_private: false },
    },
  };
  const asked: string[] = [];
  const { editor, log } = make(async (job) => (asked.push(job), { done: true, changed: true, text: `back ${job}` }), { store, tabs: [1] });
  await editor.resume();
  await settle();
  assert.deepEqual(asked.sort(), ["gone", "j9"]);
  assert.deepEqual(log.done.map(({ tab_id }) => tab_id), [1]);
  assert.deepEqual(log.saved, [{ text: "back gone", is_private: false }]);
  assert.deepEqual(store.desertfox_editor_jobs, {});
});

test("resume does not start a second loop for a job this background already collects", async () => {
  let polls = 0;
  let finish!: (reply: EditorCollectReply) => void;
  const { editor, open } = make(() => (polls++, new Promise((resolve) => (finish = resolve))));
  await open(1, 0);
  await settle();
  await editor.resume();
  await settle();
  assert.equal(polls, 1);
  finish({ done: true, changed: false });
});

test("a pending answer that came back at once makes the loop wait out the rest of a second, and a slow one does not", async () => {
  let clock = 0;
  const pauses: number[] = [];
  const answers = [{ pending: true }, { pending: true }, { done: true, changed: false }] as EditorCollectReply[];
  const spent = [100, 20_000, 0];
  let call = 0;
  const { open, log } = make(async () => ((clock += spent[call] ?? 0), answers[call++]!), { now: () => clock, pause: async (ms) => void pauses.push(ms) });
  await open(1, 0);
  await settle();
  assert.deepEqual(pauses, [900]);
  assert.equal(log.collects, 3);
});

test("the extension comes from the site row, else the global value, and the empty default means none", async () => {
  const rule = (site: string, editor_ext: string) => ({ regex: `^https://${site}/`, values: { editor_ext } });
  const keymap = { site_rules: [rule("docs\\.example", "md")] };
  const local = { get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: { ...keymap, format_version: COMPILED_KEYMAP_VERSION } }) };
  const probe = (global: string | undefined, address: string) => make_editor_ext_for(local as never, async () => global)([address]);
  assert.equal(await probe("txt", "https://docs.example/a"), "md");
  assert.equal(await probe("txt", "https://other.example/a"), "txt");
  assert.equal(await probe("", "https://other.example/a"), undefined);
  assert.equal(await probe(undefined, "https://other.example/a"), undefined);
});
