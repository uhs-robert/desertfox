import assert from "node:assert/strict";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { make_browser_handlers } from "../src/commands/browser.ts";
import { url_target, home_page_url } from "../src/commands/url_build.ts";
import { focus_page_content, start_content_once } from "../src/content/handlers/focus.ts";
import { build_config, read_commands_file } from "../tools/build-config/build_config.ts";
import { ConfigErrors } from "../src/shared/config_build/errors.ts";
import { build_schemas } from "../src/shared/config_build/schemas.ts";
import { make_tmp_dir } from "./support/tmp_dir.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "build-config");
const commands = read_commands_file(join(FIXTURES, "commands.json"));

function config_dir_with(files: Record<string, string>): string {
  const dir = make_tmp_dir("desertfox-config-");
  cpSync(join(FIXTURES, "full"), dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

function problems_of(dir: string): string {
  try {
    build_config(dir, commands);
  } catch (error) {
    if (error instanceof ConfigErrors) return error.problems.join("\n");
    throw error;
  }
  return "";
}

test("focus_page focuses window and tab in the background, then asks the page", async () => {
  const calls: string[] = [];
  const handlers = make_browser_handlers({
    window_ids: async () => [],
    close_window: async () => {},
    focus_window: async (id) => void calls.push(`window ${id}`),
    activate_tab: async (id) => void calls.push(`tab ${id}`),
    focus_page_content: async (id) => void calls.push(`page ${id}`),
  });
  await handlers.focus_page({ tab_id: 4, window_id: 2 } as never);
  assert.deepEqual(calls, ["window 2", "tab 4", "page 4"]);
});

test("the content side focuses the window, then blurs the active element", () => {
  const calls: string[] = [];
  focus_page_content(() => calls.push("focus"), () => calls.push("blur"));
  assert.deepEqual(calls, ["focus", "blur"]);
});

test("page.home opens the home_page setting or refuses", () => {
  const built_in = () => "moz-extension://x/newtab.html";
  assert.equal(home_page_url("https://home.example/", built_in), "https://home.example/");
  assert.equal(home_page_url("desertfox", built_in), `${built_in()}?builtin`);
  assert.throws(() => home_page_url(undefined, built_in), /set home_page in settings\.toml/);
});

const engines = { search: { url: "https://s.example/?q=%s" }, other: { url: "https://o.example/?q=%s" } };

test("open.clipboard opens a URL as is and searches other text", () => {
  assert.equal(url_target(" https://a.example/x \n", "search", engines, undefined), "https://a.example/x");
  assert.equal(url_target("rust lifetimes", "search", engines, undefined), "https://s.example/?q=rust%20lifetimes");
  assert.equal(url_target("rust", "other", engines, undefined), "https://o.example/?q=rust");
});

test("open.clipboard refuses with the setting name when the engine is missing", () => {
  assert.throws(() => url_target("rust", "ghost", engines, undefined), /default_engine setting/);
});

test("build-config: home_page and default_engine are checked", () => {
  const ok = config_dir_with({ "settings.toml": 'home_page = "https://h.example/"\ndefault_engine = "alpha"' });
  assert.equal(problems_of(ok), "");
  assert.match(problems_of(config_dir_with({ "settings.toml": "home_page = 3" })), /home_page: expected/);
  assert.match(problems_of(config_dir_with({ "settings.toml": 'default_engine = "ghost"' })), /default_engine: unknown search engine "ghost"/);
});

test("the settings schema lists both settings", () => {
  const properties = (build_schemas(commands).settings as { properties: Record<string, unknown> }).properties;
  assert.ok("home_page" in properties && "default_engine" in properties);
});

test("open.clipboard searches prose and refuses a script or inline address", () => {
  for (const text of ["TODO: fix thing", "rust"]) {
    assert.equal(url_target(text, "search", engines, undefined), `https://s.example/?q=${encodeURIComponent(text)}`, text);
  }
  for (const text of ["javascript:alert(1)", "data:text/html,hi"]) assert.throws(() => url_target(text, "search", engines, undefined), /DesertFox does not open/, text);
});

test("open.clipboard opens web schemes, bare domains and localhost with a port", () => {
  assert.equal(url_target("ftp://f.example/x", "search", engines, undefined), "ftp://f.example/x");
  assert.equal(url_target("example.com/path", "search", engines, undefined), "https://example.com/path");
  assert.equal(url_target("localhost:3000", "search", engines, undefined), "http://localhost:3000");
  assert.equal(url_target("two words.com", "search", engines, undefined), "https://s.example/?q=two%20words.com");
});

test("open.clipboard opens host:port, which parses as a scheme", () => {
  assert.equal(url_target("example.com:8080", "search", engines, undefined), "https://example.com:8080");
  assert.equal(url_target("localhost:3000/a?b=1", "search", engines, undefined), "http://localhost:3000/a?b=1");
});

test("url_target gives host-like text https, local hosts http and keeps full URLs", () => {
  const cases: Record<string, string> = {
    "www.google.com": "https://www.google.com",
    "google.com": "https://google.com",
    "example.com": "https://example.com",
    "github.com/x/y": "https://github.com/x/y",
    "  padded.com  ": "https://padded.com",
    "example.com:8080/a?b=1": "https://example.com:8080/a?b=1",
    localhost: "http://localhost",
    "localhost:3000": "http://localhost:3000",
    "127.0.0.1": "http://127.0.0.1",
    "192.168.1.1:8080/admin": "http://192.168.1.1:8080/admin",
    "https://a.example/x": "https://a.example/x",
    "http://a.example/x": "http://a.example/x",
    "LOCALHOST:3000": "http://LOCALHOST:3000",
    "[::1]": "http://[::1]",
    "[fd00::1]/admin": "http://[fd00::1]/admin",
    "[fe80::1]": "http://[fe80::1]",
    "[2001:db8::1]": "https://[2001:db8::1]",
    "10.0.0.5": "http://10.0.0.5",
    "172.16.0.1": "http://172.16.0.1",
    "172.32.0.1": "https://172.32.0.1",
    "192.168.1.1": "http://192.168.1.1",
    "8.8.8.8": "https://8.8.8.8",
    "8.8.8.8:8080": "https://8.8.8.8:8080",
    "nas:8080": "http://nas:8080",
    "nas:8080/path": "http://nas:8080/path",
    "mailto:x": "mailto:x",
    "tel:5551234": "tel:5551234",
    "tel:911": "tel:911",
    "tel:12345": "tel:12345",
    "[::12]": "https://[::12]",
    "[::1:2]": "https://[::1:2]",
    "[::1]:3000/a": "http://[::1]:3000/a",
    "mailto:a@b.example": "mailto:a@b.example",
    "tel:+15551234": "tel:+15551234",
    "view-source:https://a.example/": "view-source:https://a.example/",
    "magnet:?xt=urn:btih:abc": "magnet:?xt=urn:btih:abc",
    "about:blank": "about:blank",
  };
  for (const [text, expected] of Object.entries(cases)) assert.equal(url_target(text, "search", engines, undefined), expected, text);
});

test("url_target searches plain words and prose with a colon", () => {
  for (const text of ["rust", "foo bar", "[abc]", "about: config"]) {
    assert.equal(url_target(text, "search", engines, undefined), `https://s.example/?q=${encodeURIComponent(text)}`, text);
  }
});

// A refusal, not a search: the text names an address, and a search would send it to the engine.
test("url_target refuses an address off the allow-list and names its scheme", () => {
  const cases: Record<string, RegExp> = {
    "javascript:alert(1)": /does not open javascript: addresses/,
    "JavaScript:alert(1)": /does not open javascript: addresses/,
    "data:text/html,hi": /does not open data: addresses/,
    "file:///tmp/a.html": /does not open file: addresses/,
    "about:config": /does not open about: addresses/,
    "ABOUT:config": /does not open about: addresses/,
    "about:preferences#privacy": /does not open about: addresses/,
    "sms:12345": /does not open sms: addresses/,
    "blob:https://a.example/uuid": /does not open blob: addresses/,
    "view-source:file:///etc/passwd": /view-source: only for http and https/,
    "moz-extension://own-id/home.html": /A page cannot open DesertFox's own pages/,
  };
  for (const [text, refusal] of Object.entries(cases)) assert.throws(() => url_target(text, "search", engines, undefined), refusal, text);
});

test("url_target opens the extension's own page only when the request may", () => {
  const own = () => "moz-extension://own-id/";
  assert.equal(url_target("moz-extension://own-id/home.html", "search", engines, own), "moz-extension://own-id/home.html");
  assert.throws(() => url_target("moz-extension://other-id/home.html", "search", engines, own), /another extension's pages/);
});

test("url_target refuses empty text", () => {
  assert.throws(() => url_target("  ", "search", engines, undefined), /No URL/);
});

test("start_content_once waits for the focus of a frame, and starts once", () => {
  const listeners: { run: () => void; once: boolean }[] = [];
  const win = { addEventListener: (type: string, run: () => void, options: { once: boolean }) => type === "focus" && listeners.push({ run, once: options.once }) };
  let started = 0;
  start_content_once(() => started++, win as never, false);
  assert.equal(started, 0);
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0]!.once, true);
  listeners[0]!.run();
  assert.equal(started, 1);
});

test("start_content_once starts one script per window, across a second injection and a later focus", () => {
  const focus_listeners: (() => void)[] = [];
  const win = { addEventListener: (type: string, run: () => void) => type === "focus" && focus_listeners.push(run) };
  let started = 0;
  start_content_once(() => started++, win as never, false);
  start_content_once(() => started++, win as never, false);
  for (const run of focus_listeners) run();
  assert.equal(started, 1);
  start_content_once(() => started++, win as never, true);
  assert.equal(started, 1);
});

test("start_content_once starts at once in a frame that already holds the focus, with no listener", () => {
  const listeners: unknown[] = [];
  let started = 0;
  start_content_once(() => started++, { addEventListener: () => listeners.push(1) } as never, true);
  assert.equal(started, 1);
  assert.deepEqual(listeners, []);
});

test("frame.exit sends focus_page to the top frame only, with no window or focus call", async () => {
  const sent: [number, number | undefined][] = [];
  const handlers = make_browser_handlers({
    window_ids: async () => [],
    close_window: async () => assert.fail(),
    focus_window: async () => assert.fail(),
    activate_tab: async () => assert.fail(),
    focus_page_content: async (tab_id, frame_id) => void sent.push([tab_id, frame_id]),
  });
  await handlers.exit_frame({ tab_id: 4, frame_id: 3 } as never);
  await handlers.exit_frame({ tab_id: 4, frame_id: 7, window_id: undefined } as never);
  assert.deepEqual(sent, [[4, 0], [4, 0]]);
});

test("frame.exit does nothing when the keys are already in the top frame", async () => {
  const handlers = make_browser_handlers({ window_ids: async () => [], close_window: async () => {}, focus_window: async () => {}, activate_tab: async () => {}, focus_page_content: async () => assert.fail() });
  await handlers.exit_frame({ tab_id: 4, frame_id: 0 } as never);
});

test("a frame that waits for its first focus holds its start in the flag, which starts it once", () => {
  const win: Record<string, unknown> & { addEventListener: () => void } = { addEventListener: () => {} };
  let started = 0;
  start_content_once(() => started++, win as never, false);
  assert.equal(typeof win.desertfox_content_loaded, "function");
  (win.desertfox_content_loaded as () => void)();
  assert.equal(started, 1);
  assert.equal(win.desertfox_content_loaded, true);
  start_content_once(() => started++, win as never, false);
  assert.equal(started, 1);
});
