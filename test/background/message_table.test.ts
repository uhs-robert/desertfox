import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatch } from "../../src/background/message_table.ts";
import type { Handlers } from "../../src/background/message_table.ts";
import type { ToBackground } from "../../src/shared/messages/map.ts";
import { content_handlers } from "../../src/background/content_messages.ts";
import type { ContentDeps } from "../../src/background/content_messages.ts";
import { page_handlers } from "../../src/background/page_messages.ts";
import type { PageDeps } from "../../src/background/page_messages.ts";
import { is_extension_page } from "../../src/background/extension_page.ts";

type Sender = browser.runtime.MessageSender;
const ID = "test@desertfox";
const ORIGIN = "moz-extension://abc/";
const is_own_page = (sender: Sender) => is_extension_page(sender, ID, ORIGIN);

const extension_page: Sender = { id: ID, url: `${ORIGIN}help.html`, frameId: 0 };
const content_script: Sender = { id: ID, url: "https://example.com/", frameId: 0, tab: { id: 4, windowId: 1, url: "https://example.com/" } as browser.tabs.Tab };
const in_frame = (frame_id: number): Sender => ({ ...content_script, frameId: frame_id });

// A service stand-in: any method call is recorded and answers with its own name, so a test sees which service a handler reached and with what.
function recorder() {
  const calls: unknown[][] = [];
  const service = (name: string): never =>
    new Proxy({}, { get: (_target, method) => (...args: unknown[]) => (calls.push([name, method, ...args]), Promise.resolve(`${name}.${String(method)}`)) }) as never;
  return { calls, service };
}

function make_tables() {
  const { calls, service } = recorder();
  const content_deps = {
    is_own_page,
    get_config: () => Promise.resolve({ search_engines: {}, settings: {} }),
    tab_modes: service("tab_modes"),
    tab_insert: service("tab_insert"),
    hint_frames: service("hint_frames"),
    find_scan: service("find_scan"),
    inspect_relay: service("inspect_relay"),
    router: { run: (request: unknown) => (calls.push(["router.run", request]), Promise.resolve("ran")) },
    router_deps: service("router_deps"),
    media_discovery: service("media_discovery"),
    macro_replay: service("macro_replay"),
    cmdline: service("cmdline"),
    external_editor: service("external_editor"),
    frame_cue: () => "cued",
  } as unknown as ContentDeps;
  const page_deps = {
    get_config: () => Promise.resolve({}),
    settings_messages: service("settings"),
    keymap_messages: service("keymap"),
    engine_messages: service("engines"),
    alias_messages: service("aliases"),
    theme_messages: service("themes"),
    quickmark_messages: service("quickmarks"),
    font_names: { read: () => Promise.resolve(["Mono"]), refresh: () => Promise.resolve(undefined) },
  } as unknown as PageDeps;
  const content = content_handlers(content_deps);
  const page = page_handlers(page_deps);
  return { calls, content, page, handlers: { ...page, ...content } satisfies Handlers<keyof ToBackground> };
}

test("the page table and the content table share no key", () => {
  const { content, page } = make_tables();
  const shared = Object.keys(page).filter((type) => Object.hasOwn(content, type));
  assert.deepEqual(shared, []);
});

// The refusal text each page type answered before the tables, from the chain they replaced.
const REFUSALS: Record<string, unknown> = {
  change_setting: "change settings",
  list_settings: "change settings",
  site_keys: "change site rules",
  list_bindings: "change keys",
  check_binding: "change keys",
  change_keymap: "change keys",
  list_engines: "change engines",
  change_engines: "change engines",
  list_aliases: "change aliases",
  change_aliases: "change aliases",
  list_imported_themes: "change imported themes",
  change_imported_themes: "change imported themes",
  list_quickmarks: "change quickmarks",
  change_quickmarks: "change quickmarks",
  preview_config_import: "import a config",
  commit_config_import: "import a config",
  export_config: "export or change snippets",
  list_snippets: "export or change snippets",
  remove_snippet: "export or change snippets",
  config_files: "edit the config files",
  host_start_choice: "answer the config folder question",
  export_sessions: "export or import sessions",
  import_sessions: "export or import sessions",
  toolbar_set_disabled: "use the toolbar",
  toolbar_site: "use the toolbar",
  toolbar_reload_config: "use the toolbar",
};

test("every page type refuses a sender that is no extension page, with the refusal it always gave", async () => {
  const { handlers, page } = make_tables();
  const send = dispatch(handlers, is_own_page);
  assert.deepEqual(Object.keys(page).sort(), [...Object.keys(REFUSALS), "list_font_names"].sort());
  const refused_senders: Sender[] = [
    content_script,
    in_frame(3),
    { id: ID, url: `${ORIGIN}cmdline.html`, frameId: 7 },
    { id: "other@ext", url: `${ORIGIN}help.html`, frameId: 0 },
    { id: ID, url: "https://example.com/", frameId: 0 },
    { id: ID, url: `${ORIGIN}help.html`, frameId: 0, tab: { id: 1, url: "https://example.com/" } as browser.tabs.Tab },
    {},
  ];
  for (const sender of refused_senders) {
    for (const [type, what] of Object.entries(REFUSALS)) {
      assert.deepEqual(await send({ type }, sender), { ok: false, message: `only the extension's own pages may ${what}` }, `${type} from ${JSON.stringify(sender)}`);
    }
    // The one page type that refuses with an empty list, not a message.
    assert.deepEqual(await send({ type: "list_font_names" }, sender), []);
  }
});

test("an extension page, or one of its tabs, reaches the handler", async () => {
  const { handlers, calls } = make_tables();
  const send = dispatch(handlers, is_own_page);
  const own_tab: Sender = { ...extension_page, tab: { id: 9, url: `${ORIGIN}newtab.html` } as browser.tabs.Tab };
  for (const sender of [extension_page, own_tab, { id: ID, url: `${ORIGIN}help.html` }]) {
    assert.equal(await send({ type: "list_engines" }, sender), "engines.list");
    assert.equal(await send({ type: "change_keymap" }, sender), "keymap.change");
    assert.equal(await send({ type: "list_settings" }, sender), "settings.list");
    assert.deepEqual(await send({ type: "list_font_names" }, sender), ["Mono"]);
  }
  assert.equal(calls.length, 3 * 3);
});

test("a handler's own promise is the answer, so sendResponse and promise answers both work", () => {
  const answer = Promise.resolve("later");
  const table = {
    ping_a: { from: "any", run: () => answer },
    ping_b: { from: "page", refused: "no", run: () => answer },
    ping_c: { from: "tab", run: () => answer },
    ping_d: { from: "frame", run: () => answer },
  };
  const send = dispatch(table as unknown as Handlers<keyof ToBackground>, () => true);
  for (const type of ["ping_a", "ping_b", "ping_c", "ping_d"]) assert.equal(send({ type }, in_frame(0)), answer, type);
});

test("a handler that answers nothing gives the sender nothing", () => {
  const { handlers, calls } = make_tables();
  const send = dispatch(handlers, is_own_page);
  assert.equal(send({ type: "replay_stop" }, content_script), undefined);
  assert.equal(send({ type: "record_timing" }, content_script), undefined);
  assert.equal(calls.some(([name, method]) => name === "macro_replay" && method === "stop"), true);
});

test("a message no handler owns gets no answer, as before", () => {
  const { handlers, calls } = make_tables();
  const send = dispatch(handlers, is_own_page);
  const unowned = [
    { type: "no_such_type" },
    { type: "ping" },
    { type: "get_selection" },
    { type: "add_bundle_script" },
    { type: "hint_frames_collect" },
    { type: "toString" },
    { type: "constructor" },
    { type: "__proto__" },
    { type: "hasOwnProperty" },
    { type: 5 },
    { type: undefined },
    { type: null },
    {},
    "run",
    "",
    5,
    null,
    undefined,
    [],
  ];
  for (const sender of [content_script, extension_page, {}]) for (const message of unowned) assert.equal(send(message, sender), undefined, JSON.stringify(message));
  assert.deepEqual(calls, []);
});

// Where each frame or tab handler needs its sender, and nothing else needs one at the table. From the chain the tables replaced.
const FRAME_TYPES = ["mode_changed", "bar_state", "media_pin", "editor_open", "hint_frames_start", "hint_frames_report", "hint_frames_typed", "hint_frames_pick", "hint_frames_end", "hint_frames_unhover"];
const TAB_TYPES = ["leave_tab_insert", "frame_cue"];

test("the guard of each content type is the one the chain had", () => {
  const { content } = make_tables();
  const guards = Object.fromEntries(Object.entries(content).map(([type, handler]) => [type, handler.from]));
  for (const [type, from] of Object.entries(guards)) {
    const expected = FRAME_TYPES.includes(type) ? "frame" : TAB_TYPES.includes(type) ? "tab" : "any";
    assert.equal(from, expected, type);
  }
  assert.equal(Object.keys(content).length, 48);
});

test("a frame handler needs both a tab id and a frame id", () => {
  const { handlers, calls } = make_tables();
  const send = dispatch(handlers, is_own_page);
  const no_tab: Sender = { id: ID, url: "https://example.com/", frameId: 0 };
  const no_frame_id: Sender = { id: ID, url: "https://example.com/", tab: { id: 4 } as browser.tabs.Tab };
  const no_tab_id: Sender = { id: ID, frameId: 0, tab: {} as browser.tabs.Tab };
  for (const type of FRAME_TYPES) for (const sender of [no_tab, no_frame_id, no_tab_id, {}, extension_page]) assert.equal(send({ type }, sender), undefined, type);
  assert.deepEqual(calls, []);
  assert.equal(send({ type: "hint_frames_end", session_id: 1 }, in_frame(2)) instanceof Promise, true);
  assert.equal(calls.length, 1);
});

test("a frame handler gets its tab and frame ids", async () => {
  const { handlers, calls } = make_tables();
  const send = dispatch(handlers, is_own_page);
  assert.equal(await send({ type: "hint_frames_start", session_id: 1 }, in_frame(6)), "hint_frames.start");
  assert.deepEqual(calls.at(-1)?.slice(0, 5), ["hint_frames", "start", 4, 6, { type: "hint_frames_start", session_id: 1 }]);
  assert.equal(await send({ type: "hint_frames_unhover", session_id: 2 }, in_frame(6)), "hint_frames.unhover");
  assert.deepEqual(calls.at(-1), ["hint_frames", "unhover", 4, 2]);
});

test("a tab handler needs a tab id only", async () => {
  const { handlers, calls } = make_tables();
  const send = dispatch(handlers, is_own_page);
  assert.equal(send({ type: "leave_tab_insert" }, { id: ID, frameId: 0 }), undefined);
  assert.equal(send({ type: "frame_cue", toast: true }, { id: ID, frameId: 0, tab: {} as browser.tabs.Tab }), undefined);
  assert.deepEqual(calls, []);
  assert.equal(await send({ type: "leave_tab_insert" }, { tab: { id: 4 } as browser.tabs.Tab }), "tab_insert.leave");
  assert.deepEqual(calls.at(-1), ["tab_insert", "leave", 4]);
  // The top frame and a message with no frame id both pass no frame to expect_entry, as before.
  await send({ type: "frame_cue" }, { tab: { id: 4 } as browser.tabs.Tab, frameId: 0 });
  assert.deepEqual(calls.at(-1), ["tab_modes", "expect_entry", 4, undefined]);
  await send({ type: "frame_cue" }, { tab: { id: 4 } as browser.tabs.Tab });
  assert.deepEqual(calls.at(-1), ["tab_modes", "expect_entry", 4, undefined]);
  await send({ type: "frame_cue" }, { tab: { id: 4 } as browser.tabs.Tab, frameId: 3 });
  assert.deepEqual(calls.at(-1), ["tab_modes", "expect_entry", 4, 3]);
});

test("a type with its own check keeps it inside the handler", async () => {
  const { handlers, calls } = make_tables();
  const send = dispatch(handlers, is_own_page);
  // No tab: the old chain answered with a message, not with nothing.
  assert.deepEqual(await send({ type: "inspect_pick" }, { frameId: 0 }), { ok: false, message: "No tab to inspect" });
  assert.equal(await send({ type: "inspect_pick" }, content_script), "inspect_relay.pick");
  // A request that is no scan gets no answer.
  assert.equal(send({ type: "find_scan" }, content_script), undefined);
  assert.equal(send({ type: "find_scan", text: "a", source: "a", flags: "g" }, content_script) instanceof Promise, true);
  assert.equal(calls.filter(([name]) => name === "find_scan").length, 1);
});

test("a run request is marked as from a page unless an extension page sent it", async () => {
  const { handlers, calls } = make_tables();
  const send = dispatch(handlers, is_own_page);
  const run = { type: "run", invocations: [{ id: "scroll.down", args: {} }], mode: "normal" };
  await send(run, content_script);
  await send(run, extension_page);
  const [from_content, from_page] = calls.filter(([name]) => name === "router.run").map(([, request]) => request as Record<string, unknown>);
  assert.equal(from_content?.["from_page"], true);
  assert.equal(from_content?.["sender_tab_id"], 4);
  assert.equal("from_page" in (from_page ?? {}), false);
});

test("a run request carries from_line only when the sender sets it", async () => {
  const { handlers, calls } = make_tables();
  const send = dispatch(handlers, is_own_page);
  const run = { type: "run", invocations: [{ id: "scroll.down", args: {} }], mode: "normal" };
  await send(run, content_script);
  await send({ ...run, from_line: true }, content_script);
  const [plain, typed] = calls.filter(([name]) => name === "router.run").map(([, request]) => request as Record<string, unknown>);
  assert.equal("from_line" in (plain ?? {}), false);
  assert.equal(typed?.["from_line"], true);
  assert.equal(typed?.["from_page"], true);
});
