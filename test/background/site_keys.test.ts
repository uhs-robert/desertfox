import assert from "node:assert/strict";
import { test } from "node:test";
import { answer_site_keys_request, is_pass_shaped, key_column_refusal, pass_words, sample_address, site_is_off_for, site_rows_with_pass, site_rows_without_pass } from "../../src/background/site_keys.ts";
import type { SiteRuleRow } from "../../src/shared/match_pattern.ts";

const MAIL = "*://*.mail.test/*";

test("only a row of site and pass belongs to the form", () => {
  assert.equal(is_pass_shaped({ site: MAIL, pass: "j k" }), true);
  assert.equal(is_pass_shaped({ site: MAIL, pass: "j", off: false }), false);
  assert.equal(is_pass_shaped({ site: MAIL, only: "j" }), false);
  assert.equal(is_pass_shaped({ site: MAIL }), false);
});

test("a pattern gives one address it covers, and none when the host has a wildcard inside", () => {
  assert.equal(sample_address(MAIL), "https://mail.test/");
  assert.equal(sample_address("https://mail.test/inbox/*"), "https://mail.test/inbox/");
  assert.equal(sample_address("*://*/*"), undefined);
  assert.equal(sample_address("*://a.*.test/*"), undefined);
  assert.equal(sample_address("not a pattern"), undefined);
});

test("pass words are checked one by one and listed once", () => {
  assert.deepEqual(pass_words("j  k j <C-x>"), { words: ["j", "k", "<C-x>"] });
  assert.ok("problem" in pass_words(""));
  assert.ok("problem" in pass_words("j <x>"));
});

test("Save appends a new row after the others and replaces the form's row in place", () => {
  const rows: SiteRuleRow[] = [{ site: "*://*.a.test/*", off: true }];
  const added = site_rows_with_pass(rows, MAIL, "j k");
  assert.deepEqual(added, { rows: [...rows, { site: MAIL, pass: "j k" }] });
  const later = [...(added as { rows: SiteRuleRow[] }).rows, { site: "*://*.b.test/*", off: true }];
  assert.deepEqual(site_rows_with_pass(later, MAIL, "j"), { rows: [rows[0], { site: MAIL, pass: "j" }, later[2]] });
});

test("Remove takes out the form's row only", () => {
  const rows: SiteRuleRow[] = [{ site: MAIL, pass: "j" }, { site: MAIL, off: true }];
  assert.deepEqual(site_rows_without_pass(rows, MAIL), [rows[1]]);
  assert.equal(site_rows_without_pass([rows[1]!], MAIL), undefined);
  assert.deepEqual(site_rows_without_pass([{ site: MAIL, pass: "j" }, rows[1]!, { site: MAIL, pass: "k" }], MAIL), [rows[1]]);
});

test("an earlier row that sets the key column refuses the Save and is named", () => {
  const earlier: SiteRuleRow[] = [{ site: "*://*.test/*", pass: "q" }];
  const refused = site_rows_with_pass(earlier, MAIL, "j");
  assert.ok("refusal" in refused && refused.refusal.includes("*://*.test/*"));
  assert.match(key_column_refusal([{ site: MAIL, only: "j" }], MAIL) ?? "", /sets only with other fields/);
  assert.equal(key_column_refusal([{ site: "*://*.test/*", off: true }], MAIL), undefined);
  // A row after the form's own row never shadows it.
  assert.equal(key_column_refusal([{ site: MAIL, pass: "j" }, { site: "*://*.test/*", pass: "q" }], MAIL), undefined);
});

test("an off rule on the site is reported", () => {
  assert.equal(site_is_off_for([{ site: MAIL, off: true }], MAIL), true);
  assert.equal(site_is_off_for([{ site: MAIL, pass: "j" }], MAIL), false);
});

test("the request is checked and the note of the file write ends the answer", async () => {
  const calls: unknown[] = [];
  const deps = { change_site_keys: async (pattern: string, keys: string | null) => (calls.push([pattern, keys]), { note: ", saved to settings.toml" }) };
  assert.deepEqual(await answer_site_keys_request({ type: "site_keys", pattern: MAIL, keys: "j k" }, deps), { ok: true, message: `Keys kept for ${MAIL}, saved to settings.toml` });
  assert.deepEqual(await answer_site_keys_request({ type: "site_keys", pattern: MAIL, keys: null }, deps), { ok: true, message: `Keys no longer kept for ${MAIL}, saved to settings.toml` });
  assert.equal((await answer_site_keys_request({ type: "site_keys", pattern: "mail", keys: "j" }, deps)).ok, false);
  assert.equal((await answer_site_keys_request({ type: "site_keys", pattern: "*://exa*mple.com/*", keys: "j" }, deps)).ok, false);
  assert.equal((await answer_site_keys_request({ type: "site_keys", pattern: "<all_urls>", keys: "j" }, deps)).ok, true);
  const nothing = { change_site_keys: async () => ({ unchanged: true as const }) };
  assert.deepEqual(await answer_site_keys_request({ type: "site_keys", pattern: MAIL, keys: null }, nothing), { ok: true, message: `No kept keys for ${MAIL} to remove` });
  assert.equal((await answer_site_keys_request({ type: "site_keys", pattern: MAIL, keys: "" }, deps)).ok, false);
  assert.equal(calls.length, 3);
  const failing = { change_site_keys: async () => Promise.reject(new Error("Not saved. no")) };
  assert.deepEqual(await answer_site_keys_request({ type: "site_keys", pattern: MAIL, keys: "j" }, failing), { ok: false, message: "Not saved. no" });
});
