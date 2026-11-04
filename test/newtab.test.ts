import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { BUILT_IN_QUERY, resolve_new_tab_page } from "../src/shared/config.ts";
import { build_config, read_commands_file } from "../tools/build-config/build_config.ts";
import { ConfigErrors } from "../tools/build-config/errors.ts";
import { build_schemas } from "../tools/build-config/schemas.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "build-config");
const commands = read_commands_file(join(FIXTURES, "commands.json"));

function problems_with_settings(settings_toml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "oasisfox-config-"));
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
  for (const value of [undefined, "oasisfox", "", "javascript:alert(1)", "data:text/html,hi", "about:blank", "start.example", "https://%", "https://example.com:99999", "https://example.com:abc"]) {
    assert.deepEqual(resolve_new_tab_page(value), { kind: "built_in" }, String(value));
  }
});

test("build-config: new_tab_page takes oasisfox or a web URL and rejects the rest", () => {
  assert.equal(problems_with_settings('new_tab_page = "oasisfox"'), "");
  assert.equal(problems_with_settings('new_tab_page = "https://start.example/"'), "");
  for (const value of ['"javascript:alert(1)"', '"start.example"', '""', "3", '"https://%"', '"https://example.com:99999"', '"https://example.com:abc"']) {
    assert.match(problems_with_settings(`new_tab_page = ${value}`), /new_tab_page: expected/, value);
  }
});

test("the settings schema pins new_tab_page to the same two forms", () => {
  const properties = (build_schemas(commands).settings as { properties: Record<string, { pattern?: string }> }).properties;
  const pattern = new RegExp(properties.new_tab_page?.pattern ?? "$^");
  assert.ok(pattern.test("oasisfox") && pattern.test("https://a.example/"));
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

test("the settings schema lists the widget settings and no removed one", () => {
  const properties = (build_schemas(commands).settings as { properties: Record<string, unknown> }).properties;
  for (const name of ["newtab_clock", "newtab_date"]) assert.ok(name in properties, name);
  for (const name of ["newtab_ip", "newtab_weather", "weather_units", "weather_lat", "weather_lon"]) assert.ok(!(name in properties), name);
});
