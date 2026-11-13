import assert from "node:assert/strict";
import { test } from "node:test";
import { create_external_editor, ext_of_request, make_editor_ext_for } from "../../src/background/external_editor.ts";
import type { EditorCollectReply } from "../../src/background/native_client.ts";
import { NativeHostError } from "../../src/background/native_client.ts";
import { COMPILED_KEYMAP_STORAGE_KEY, COMPILED_KEYMAP_VERSION } from "../../src/shared/prefix_tree.ts";
import type { EditorDone, EditorOpen } from "../../src/shared/messages.ts";

const request = (token = "t1"): EditorOpen => ({ type: "editor_open", token, text: "hello", insert: false });
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const forever = () => new Promise<EditorCollectReply>(() => {});

type Options = { store?: Record<string, unknown>; start?: () => Promise<string>; tabs?: number[]; now?: () => number; pause?: (ms: number) => Promise<void>; delivered?: boolean; save?: () => Promise<void>; private_window?: boolean };

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
    private_window_open: async () => options.private_window ?? true,
    now: options.now ?? (() => 0),
    pause: options.pause ?? (async () => {}),
  });
  const open = (tab_id: number, frame_id: number, token = "t1", ext?: string, insert = false) => editor.open(tab_id, frame_id, { ...request(token), insert }, ext, false, editor.navigation_stamp(tab_id));
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
  const { open, log } = make(() => (fail ? Promise.reject(new NativeHostError("host_failed", "unknown editor job")) : forever()));
  await open(1, 2);
  await settle();
  assert.deepEqual(log.toasts, ["unknown editor job"]);
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

const GONE = { ok: false, message: "The page was gone before the editor started" };

test("a press whose page navigated before its turn starts no editor, and the new page's press opens one", async () => {
  const { editor, open, log, store } = make(forever);
  const stale = editor.navigation_stamp(1);
  await editor.orphan(1);
  assert.deepEqual(await editor.open(1, 0, request("old"), undefined, false, stale), GONE);
  assert.deepEqual(log.starts, []);
  assert.deepEqual(Object.values(store)[0] ?? {}, {});
  assert.equal((await open(1, 0, "new")).ok, true, "no live job blocks the new page");
});

test("a stale open refuses whether it queued before or after the orphan", async () => {
  const { editor, log } = make(forever);
  const ahead = editor.open(1, 0, request("ahead"), undefined, false, editor.navigation_stamp(1));
  void editor.orphan(1);
  assert.deepEqual(await ahead, GONE, "the count moves at once, so the turn already queued sees it");
  const behind_stamp = editor.navigation_stamp(1);
  const orphaned = editor.orphan(1);
  assert.deepEqual(await editor.open(1, 0, request("behind"), undefined, false, behind_stamp), GONE);
  await orphaned;
  assert.deepEqual(log.starts, []);
});

test("a navigation while the host starts the editor orphans the new job", async () => {
  let started!: (job: string) => void;
  const { editor, open, store } = make(forever, { start: () => new Promise((resolve) => (started = resolve)) });
  const answer = open(1, 0);
  await settle();
  const orphaned = editor.orphan(1);
  started("job1");
  assert.deepEqual(await answer, { ok: true });
  await orphaned;
  assert.equal((Object.values(store)[0] as Record<string, { orphaned?: true }>).job1?.orphaned, true);
});

test("a tab closed during setup starts no editor and leaves other tabs alone", async () => {
  const { editor, open, log } = make(forever);
  const stale = editor.navigation_stamp(2);
  const other = editor.navigation_stamp(3);
  await editor.orphan(2);
  assert.deepEqual(await editor.open(2, 0, request(), undefined, false, stale), GONE);
  assert.equal((await editor.open(3, 0, request(), undefined, false, other)).ok, true);
  assert.equal(log.starts.length, 1);
  assert.equal((await open(1, 0)).ok, true);
});

test("the count holds across several navigations and interleaved presses", async () => {
  const { editor, open, log } = make(forever);
  const first = editor.navigation_stamp(1);
  await editor.orphan(1);
  const second = editor.navigation_stamp(1);
  await editor.orphan(1);
  const [a, b] = await Promise.all([editor.open(1, 0, request("a"), undefined, false, first), editor.open(1, 0, request("b"), undefined, false, second)]);
  assert.deepEqual([a, b], [GONE, GONE]);
  assert.deepEqual(log.starts, []);
  const [c, d] = await Promise.all([open(1, 0, "c"), open(1, 0, "d")]);
  assert.deepEqual([c.ok, d], [true, { ok: false, message: "An editor is already open for this tab" }], "the current page's presses behave as before");
});

test("a restarted background has no count and still opens an editor for a tab with only orphaned jobs", async () => {
  const store: Record<string, unknown> = { desertfox_editor_jobs: { old: { job: "old", tab_id: 1, token: "x", frame_id: 0, is_private: false, orphaned: true } } };
  const { editor, open } = make(forever, { store });
  await editor.resume();
  assert.equal(editor.navigation_stamp(1), 0);
  assert.equal((await open(1, 0)).ok, true);
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
  await editor.open(1, 0, request(), undefined, true, editor.navigation_stamp(1));
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

test("a private result with no private window open any more is dropped with a toast", async () => {
  const { editor, log } = make(async () => ({ done: true, changed: true, text: "secret" }), { delivered: false, private_window: false });
  await editor.open(1, 0, request(), undefined, true, editor.navigation_stamp(1));
  await settle();
  assert.deepEqual(log.saved, []);
  assert.match(log.toasts[0] ?? "", /private window was gone.*dropped/);
});

test("a failed collect is tried again, and a later answer still delivers", async () => {
  let call = 0;
  const pauses: number[] = [];
  const { open, log } = make(async () => (++call < 3 ? Promise.reject(new NativeHostError("host_failed", "spawn failed")) : { done: true, changed: true, text: "ok" }), { pause: async (ms) => void pauses.push(ms) });
  await open(1, 0);
  await settle();
  assert.equal(call, 3);
  assert.deepEqual(pauses, [1000, 1000]);
  assert.deepEqual(log.toasts, []);
  assert.equal(log.done.length, 1);
});

test("three failed collects in a row give up and the toast names the folder that keeps the text", async () => {
  const { open, log, store } = make(() => Promise.reject(new NativeHostError("host_failed", "spawn failed")));
  await open(1, 0);
  await settle();
  assert.equal(log.collects, 3);
  assert.match(log.toasts[0] ?? "", /spawn failed.*~\/\.cache\/desertfox\/editor/);
  assert.deepEqual(store.desertfox_editor_jobs, {});
});

test("the host's unknown-job refusal gives up at once, with no retry and no folder", async () => {
  const { open, log } = make(() => Promise.reject(new NativeHostError("host_failed", "The DesertFox native host refused: unknown editor job: its text was already taken")));
  await open(1, 0);
  await settle();
  assert.equal(log.collects, 1);
  assert.doesNotMatch(log.toasts[0] ?? "", /\.cache/);
});

test("an empty ext from the page means not given, so the site's extension applies", async () => {
  const site = async () => "md";
  assert.equal(await ext_of_request("", site), "md");
  assert.equal(await ext_of_request(undefined, site), "md");
  assert.equal(await ext_of_request("", async () => undefined), undefined);
  assert.equal(await ext_of_request("txt", site), "txt");
});
