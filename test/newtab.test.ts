import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { BUILT_IN_QUERY, resolve_new_tab_page } from "../src/shared/config.ts";
import { build_config, read_commands_file } from "../tools/build-config/build_config.ts";
import { ConfigErrors } from "../src/shared/config_build/errors.ts";
import { build_schemas } from "../src/shared/config_build/schemas.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "build-config");
const commands = read_commands_file(join(FIXTURES, "commands.json"));

function problems_with_settings(settings_toml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "desertfox-config-"));
  cpSync(join(FIXTURES, "full"), dir, { recursive: true });
  mkdirSync(dirname(join(dir, "settings.toml")), { recursive: true });
  writeFileSync(join(dir, "settings.toml"), settings_toml);
  try {
    build_config(dir, commands);
  } catch (error) {
    if (error instanceof ConfigErrors) return error.problems.join("\n");
    throw error;
  }
  return "";
}

test("new_tab_page: a web URL redirects, anything else shows the built-in page", () => {
  assert.deepEqual(resolve_new_tab_page("https://start.example/"), { kind: "redirect", url: "https://start.example/" });
  assert.deepEqual(resolve_new_tab_page("http://localhost:8080/"), { kind: "redirect", url: "http://localhost:8080/" });
  for (const value of [undefined, "desertfox", "", "javascript:alert(1)", "data:text/html,hi", "about:blank", "start.example", "https://%", "https://example.com:99999", "https://example.com:abc"]) {
    assert.deepEqual(resolve_new_tab_page(value), { kind: "built_in" }, String(value));
  }
});

test("build-config: new_tab_page takes desertfox or a web URL and rejects the rest", () => {
  assert.equal(problems_with_settings('new_tab_page = "desertfox"'), "");
  assert.equal(problems_with_settings('new_tab_page = "https://start.example/"'), "");
  for (const value of ['"javascript:alert(1)"', '"start.example"', '""', "3", '"https://%"', '"https://example.com:99999"', '"https://example.com:abc"']) {
    assert.match(problems_with_settings(`new_tab_page = ${value}`), /new_tab_page: expected/, value);
  }
});

test("the settings schema pins new_tab_page to the same two forms", () => {
  const properties = (build_schemas(commands).settings as { properties: Record<string, { pattern?: string }> }).properties;
  const pattern = new RegExp(properties.new_tab_page?.pattern ?? "$^");
  assert.ok(pattern.test("desertfox") && pattern.test("https://a.example/"));
  assert.ok(!pattern.test("javascript:alert(1)") && !pattern.test("start.example"));
});

test("the built-in query keeps the page from redirecting, so home shows the built-in page", () => {
  assert.deepEqual(resolve_new_tab_page("https://start.example/", `?${BUILT_IN_QUERY}`), { kind: "built_in" });
  assert.deepEqual(resolve_new_tab_page("https://start.example/", ""), { kind: "redirect", url: "https://start.example/" });
});

test("build-config: the widget settings take booleans and reject the rest", () => {
  assert.equal(problems_with_settings("newtab_clock = false\nnewtab_date = true"), "");
  for (const line of ['newtab_clock = "yes"', "newtab_date = 1"]) assert.match(problems_with_settings(line), /expected/, line);
});

test("build-config: newtab_clock takes false, true, analog and digital", () => {
  for (const value of ["false", "true", '"analog"', '"digital"']) assert.equal(problems_with_settings(`newtab_clock = ${value}`), "", value);
  for (const value of ['"yes"', '"Digital"', "1"]) assert.match(problems_with_settings(`newtab_clock = ${value}`), /newtab_clock: expected/, value);
});

test("build-config: newtab_clock_format takes 12 or 24 only", () => {
  for (const value of ["12", "24"]) assert.equal(problems_with_settings(`newtab_clock_format = ${value}`), "", value);
  for (const value of ["0", "13", "12.5", '"24"', "true"]) assert.match(problems_with_settings(`newtab_clock_format = ${value}`), /newtab_clock_format: expected 12 or 24/, value);
});

test("the settings schema lists the widget settings", () => {
  const properties = (build_schemas(commands).settings as { properties: Record<string, unknown> }).properties;
  for (const name of ["newtab_clock", "newtab_date", "newtab_clock_format"]) assert.ok(name in properties, name);
});

test("the settings schema pins the clock values and the format", () => {
  const properties = (build_schemas(commands).settings as { properties: Record<string, { enum?: unknown[]; default?: unknown }> }).properties;
  assert.deepEqual(properties.newtab_clock?.enum, [true, false, "analog", "digital"]);
  assert.deepEqual(properties.newtab_clock_format?.enum, [12, 24]);
  assert.equal(properties.newtab_clock_format?.default, 12);
});

test("build-config: [[newtab_links]] takes web links and names the bad one", () => {
  assert.equal(problems_with_settings('[[newtab_links]]\nlabel = "A"\nurl = "https://a.example/"\ngroup = "Work"\n[[newtab_links]]\nlabel = "B"\nurl = "http://b.example/"'), "");
  assert.match(problems_with_settings('[[newtab_links]]\nlabel = "A"\nurl = "javascript:alert(1)"'), /newtab_links: expected a list of tables/);
  assert.match(problems_with_settings('[[newtab_links]]\nlabel = "A"\nurl = "https://a.example/"\ngroup = ""'), /newtab_links: expected/);
});

test("build-config: the list flags take booleans and the maxes take whole numbers", () => {
  assert.equal(problems_with_settings("newtab_bookmarks = true\nnewtab_recent_tabs = false\nnewtab_bookmarks_max = 0\nnewtab_recent_tabs_max = 12"), "");
  for (const line of ['newtab_bookmarks = "yes"', "newtab_recent_tabs = 1", "newtab_bookmarks_max = -1", "newtab_recent_tabs_max = 2.5"]) assert.match(problems_with_settings(line), /expected/, line);
});

test("build-config: a bad newtab_links item is named by index, label and field", () => {
  const second_bad = '[[newtab_links]]\nlabel = "A"\nurl = "https://a.example/"\n[[newtab_links]]\nlabel = "Bad"\nurl = "javascript:1"';
  assert.match(problems_with_settings(second_bad), /newtab_links: expected .*, but item 2 \("Bad"\) needs an http or https "url"/);
  assert.match(problems_with_settings('[[newtab_links]]\nurl = "https://a.example/"'), /but item 1 needs a non-empty "label"/);
  assert.match(problems_with_settings('[[newtab_links]]\nlabel = "A"\nurl = "https://a.example/"\nlink = 1'), /item 1 \("A"\) has the unknown field "link"/);
});

test("the built-in links include Settings, third after Getting Started and Help", () => {
  const html = readFileSync(new URL("../src/newtab/newtab.html", import.meta.url), "utf8");
  const nav = /<nav class="builtin-links">([\s\S]*?)<\/nav>/.exec(html)![1]!;
  const anchors = [...nav.matchAll(/<a href="([^"]*)">([^<]*)<\/a>/g)].map((match) => [match[2], match[1]]);
  assert.deepEqual(anchors, [["Getting Started", "home.html#/quick-start"], ["Help", "home.html"], ["Settings", "home.html#/settings"]]);
});
