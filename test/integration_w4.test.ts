import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { make_browser_handlers } from "../src/commands/browser.ts";
import { clipboard_target, home_page_url } from "../src/commands/url_build.ts";
import { focus_page_content } from "../src/content/handlers/focus.ts";
import { build_config, read_commands_file } from "../tools/build-config/build_config.ts";
import { ConfigErrors } from "../tools/build-config/errors.ts";
import { build_schemas } from "../tools/build-config/schemas.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "build-config");
const commands = read_commands_file(join(FIXTURES, "commands.json"));

function config_dir_with(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "oasisfox-config-"));
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
  assert.equal(home_page_url("https://home.example/"), "https://home.example/");
  assert.throws(() => home_page_url(undefined), /set home_page in settings\.jsonc/);
});

const engines = { search: { url: "https://s.example/?q=%s" }, other: { url: "https://o.example/?q=%s" } };

test("open.clipboard opens a URL as is and searches other text", () => {
  assert.equal(clipboard_target(" https://a.example/x \n", "search", engines), "https://a.example/x");
  assert.equal(clipboard_target("rust lifetimes", "search", engines), "https://s.example/?q=rust%20lifetimes");
  assert.equal(clipboard_target("rust", "other", engines), "https://o.example/?q=rust");
});

test("open.clipboard refuses with the setting name when the engine is missing", () => {
  assert.throws(() => clipboard_target("rust", "ghost", engines), /default_engine setting/);
});

test("build-config: home_page and default_engine are checked", () => {
  const ok = config_dir_with({ "settings.jsonc": '{ "home_page": "https://h.example/", "default_engine": "alpha" }' });
  assert.equal(problems_of(ok), "");
  assert.match(problems_of(config_dir_with({ "settings.jsonc": '{ "home_page": 3 }' })), /home_page: expected/);
  assert.match(problems_of(config_dir_with({ "settings.jsonc": '{ "default_engine": "ghost" }' })), /default_engine: unknown search engine "ghost"/);
});

test("the settings schema lists both settings", () => {
  const properties = (build_schemas(commands).settings as { properties: Record<string, unknown> }).properties;
  assert.ok("home_page" in properties && "default_engine" in properties);
});

test("open.clipboard searches text that only parses as a URL", () => {
  for (const text of ["javascript:alert(1)", "TODO: fix thing", "data:text/html,hi", "rust"]) {
    assert.equal(clipboard_target(text, "search", engines), `https://s.example/?q=${encodeURIComponent(text)}`, text);
  }
});

test("open.clipboard opens web schemes, bare domains and localhost with a port", () => {
  assert.equal(clipboard_target("ftp://f.example/x", "search", engines), "ftp://f.example/x");
  assert.equal(clipboard_target("file:///tmp/a.html", "search", engines), "file:///tmp/a.html");
  assert.equal(clipboard_target("example.com/path", "search", engines), "https://example.com/path");
  assert.equal(clipboard_target("localhost:3000", "search", engines), "http://localhost:3000");
  assert.equal(clipboard_target("two words.com", "search", engines), "https://s.example/?q=two%20words.com");
});
