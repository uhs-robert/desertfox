import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIG_STATUS_STORAGE_KEY } from "../src/background/storage_keys.ts";
import { create_media_quality } from "../src/background/media_quality.ts";
import { hint_selectors_reply, join_mode, media_quality_is_idle, media_quality_reply, rule_addresses_of, sender_at, page_keymap_for, read_keymap_reply, site_columns_for, site_value, top_frame_address_of } from "../src/background/page_keymap.ts";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/background/config_load.ts";
import "../src/background/command_modules.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import { DEFAULT_SITE_ROWS } from "../src/background/default_site_rows.ts";
import { DEFAULT_SITE_ROW_NAMES } from "../src/shared/table_constants.ts";
import type { TreeLeaf, TreeNode } from "../src/shared/prefix_tree.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { create_keymap_asks } from "../src/content/ask_keymap.ts";
import { create_key_flow } from "../src/content/key_flow.ts";
import { create_mode_state } from "../src/content/mode_state.ts";
import { compile_keymap, create_matcher } from "../src/shared/keys/index.ts";
import { frees_of } from "../src/shared/keys/prune_tree.ts";
import type { KeyRule } from "../src/shared/keys/prune_tree.ts";
import type { KeymapConfig } from "../src/shared/index.ts";
import { COMPILED_KEYMAP_STORAGE_KEY, is_freed } from "../src/shared/prefix_tree.ts";
import type { CompiledKeymap, PageKeymap } from "../src/shared/prefix_tree.ts";

const resolve = () => ({ runs_in: "content" as const, label: "x", count: "ignore" as const });
const KEYMAP: KeymapConfig = {
  normal: { j: { id: "a.j" }, k: { id: "a.k" }, gg: { id: "a.gg" }, ",i": { id: "a.ignore" }, "<S-Escape>": { id: "a.leave" }, "<C-v>": { id: "a.v" } },
  browser: { "<A-j>": { id: "a.tab" } },
};
const compile = (site_rules: { site: string; off?: boolean; pass?: string; only?: string }[]) => compile_keymap(KEYMAP, { site_rules }, resolve).compiled;
const storage_of = (stored: unknown) => ({ get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: stored }) }) as never;
const ask = async (compiled: CompiledKeymap | undefined, ...addresses: string[]) => page_keymap_for(storage_of(compiled), addresses);

test("a page with no rule gets the whole keymap and no frees", async () => {
  const compiled = compile([{ site: "https://a.test/*", pass: "j" }]);
  const reply = (await ask(compiled, "https://b.test/"))!;
  assert.equal(reply.all_off, false);
  assert.equal(reply.frees, undefined);
  assert.deepEqual(reply.keymap.modes, compiled.modes);
});

test("the reply never carries site_rules", async () => {
  const compiled = compile([{ site: "https://a.test/*", pass: "j" }, { site: "https://b.test/*", only: "j" }, { site: "https://c.test/*" }]);
  for (const url of ["https://a.test/", "https://b.test/", "https://c.test/", "https://d.test/"]) assert.equal("site_rules" in (await ask(compiled, url))!.keymap, false, url);
});

test("a pass rule trims the normal tree and frees its single keys", async () => {
  const reply = (await ask(compile([{ site: "https://a.test/*", pass: "j <Space>" }]), "https://a.test/"))!;
  assert.equal(reply.keymap.modes.normal?.children["j"], undefined);
  assert.equal(reply.keymap.modes.normal?.children["<Space>"], undefined);
  assert.ok(reply.keymap.modes.normal?.children["k"]);
  assert.ok(reply.keymap.modes.browser?.children["<A-j>"]);
  assert.deepEqual(reply.frees, { tokens: ["j", "<Space>"], invert: false });
});

test("an only rule keeps the listed keys and frees every other key", async () => {
  const reply = (await ask(compile([{ site: "https://a.test/*", only: "j" }]), "https://a.test/"))!;
  assert.deepEqual(Object.keys(reply.keymap.modes.normal!.children).sort(), ["<C-v>", "<S-Escape>", "j"]);
  assert.equal(reply.frees?.invert, true);
  assert.equal(is_freed(reply.frees!, "x"), true);
  assert.equal(is_freed(reply.frees!, "j"), false);
});

test("an all-off page keeps the whole normal tree, so ,i and the way out stay", async () => {
  const compiled = compile([{ site: "https://a.test/*" }]);
  const reply = (await ask(compiled, "https://a.test/"))!;
  assert.equal(reply.all_off, true);
  assert.equal(reply.frees, undefined);
  assert.deepEqual(reply.keymap.modes.normal, compiled.modes.normal);
  assert.ok((reply.keymap.modes.normal?.children[","] as { children: Record<string, unknown> }).children["i"]);
});

test("the first matching key rule wins", async () => {
  const compiled = compile([{ site: "https://a.test/*", pass: "j" }, { site: "https://a.test/*", pass: "k" }]);
  assert.deepEqual((await ask(compiled, "https://a.test/"))!.frees?.tokens, ["j"]);
});

test("an off = false row keeps a page on under a broader off row, and a later row still gives the key rule", async () => {
  const compiled = compile([{ site: "https://a.test/app/*", off: false }, { site: "https://a.test/*", pass: "j" }, { site: "https://a.test/*", off: true }]);
  const kept = (await ask(compiled, "https://a.test/app/x"))!;
  assert.equal(kept.all_off, false);
  assert.deepEqual(kept.frees?.tokens, ["j"]);
  const off = (await ask(compiled, "https://a.test/other"))!;
  assert.equal(off.all_off, true);
  assert.equal(off.frees, undefined);
  assert.deepEqual(off.keymap.modes.normal, compiled.modes.normal);
});

test("an edit between two asks reaches the open page on the next ask", async () => {
  let stored = compile([{ site: "https://a.test/*", pass: "j" }]);
  const storage = { get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: stored }) } as never;
  assert.equal((await page_keymap_for(storage, ["https://a.test/"]))!.all_off, false);
  // The popup appends an off row below the file's key row: the off column was unset, so the new row decides it.
  stored = compile([{ site: "https://a.test/*", pass: "j" }, { site: "https://a.test/*", off: true }]);
  assert.equal((await page_keymap_for(storage, ["https://a.test/"]))!.all_off, true);
  stored = compile([{ site: "https://a.test/*", pass: "j" }]);
  const back = (await page_keymap_for(storage, ["https://a.test/"]))!;
  assert.equal(back.all_off, false);
  assert.deepEqual(back.frees?.tokens, ["j"]);
});

test("a site value beats the global value, which holds :set, and only on its sites", () => {
  // No setting opts in yet, so the rows are cast: the compiler copies every column besides site, off, pass and only.
  const compiled = compile([{ site: "https://a.test/*", zoom: 2 }] as unknown as Parameters<typeof compile>[0]);
  // The name and value are cast too: `site_value` takes only per-site setting names, and there are none yet.
  assert.equal(site_value(site_columns_for(compiled, ["https://a.test/"]), "zoom" as never, 1.25 as never), 2);
  assert.equal(site_value(site_columns_for(compiled, ["https://b.test/"]), "zoom" as never, 1.25 as never), 1.25);
  // A false or zero site value still wins.
  const falsy = compile([{ site: "https://a.test/*", flag: false }] as unknown as Parameters<typeof compile>[0]);
  assert.equal(site_value(site_columns_for(falsy, ["https://a.test/"]), "flag" as never, true as never), false);
});

test("blur_on_load reaches a page as a site value, and a frame resolves it against its own address only", async () => {
  const compiled = compile_keymap(KEYMAP, { site_rules: [{ site: "https://top.test/*", blur_on_load: true }] }, resolve).compiled;
  const top = rule_addresses_of({ frameId: 0, url: "https://top.test/", tab: { url: "https://top.test/" } });
  assert.deepEqual((await page_keymap_for(storage_of(compiled), top))!.site_values, { blur_on_load: true });
  // The tab address would match the row, but a frame of another site follows its own rows.
  const frame = rule_addresses_of({ frameId: 7, url: "https://embed.test/", tab: { url: "https://top.test/page" } });
  assert.equal((await page_keymap_for(storage_of(compiled), frame))!.site_values, undefined);
  // The site rows stay with the background: the page gets the resolved values only.
  assert.equal("frame_site_globals" in (await page_keymap_for(storage_of(compiled), top))!.keymap, false);
});

test("escape_to_page reaches a page as a site value for its own address only", async () => {
  const compiled = compile_keymap(KEYMAP, { site_rules: [{ site: "https://top.test/*", escape_to_page: true }] }, resolve).compiled;
  const top = rule_addresses_of({ frameId: 0, url: "https://top.test/", tab: { url: "https://top.test/" } });
  assert.deepEqual((await page_keymap_for(storage_of(compiled), top))!.site_values, { escape_to_page: true });
  const frame = rule_addresses_of({ frameId: 7, url: "https://embed.test/", tab: { url: "https://top.test/page" } });
  assert.equal((await page_keymap_for(storage_of(compiled), frame))!.site_values, undefined);
});

test("scroll_selector reaches a page as a site value for its own address only", async () => {
  const compiled = compile_keymap(KEYMAP, { site_rules: [{ site: "https://top.test/*", scroll_selector: "#pane" }] }, resolve).compiled;
  const top = rule_addresses_of({ frameId: 0, url: "https://top.test/", tab: { url: "https://top.test/" } });
  assert.deepEqual((await page_keymap_for(storage_of(compiled), top))!.site_values, { scroll_selector: "#pane" });
  const other = rule_addresses_of({ frameId: 0, url: "https://other.test/", tab: { url: "https://other.test/" } });
  assert.equal((await page_keymap_for(storage_of(compiled), other))!.site_values, undefined);
});

test("the global blur_on_load reaches every page, and a site row turns it off there", async () => {
  const compiled = compile_keymap(KEYMAP, { blur_on_load: true, site_rules: [{ site: "https://quiet.test/*", blur_on_load: false }] }, resolve).compiled;
  assert.deepEqual(compiled.frame_site_globals, { blur_on_load: true });
  assert.deepEqual((await ask(compiled, "https://a.test/"))!.site_values, { blur_on_load: true });
  assert.equal((await ask(compiled, "https://quiet.test/"))!.site_values, undefined);
  assert.equal("frame_site_globals" in (await ask(compiled, "https://a.test/"))!.keymap, false);
  // A value at its default stays out of the stored keymap and of the reply.
  assert.equal("frame_site_globals" in compile_keymap(KEYMAP, { blur_on_load: false }, resolve).compiled, false);
});

test("hint selectors answer read_hint_selectors for the frame's own address, and stay out of the page keymap reply", async () => {
  const compiled = compile_keymap(KEYMAP, { hint_add: [".card"], site_rules: [{ site: "https://top.test/*", hint_remove: ["nav"] }, { site: "https://bare.test/*", hint_add: [] }] }, resolve).compiled;
  assert.deepEqual(compiled.frame_site_globals, { hint_add: [".card"] });
  assert.deepEqual(await hint_selectors_reply(storage_of(compiled), "https://top.test/"), { hint_add: [".card"], hint_remove: ["nav"] });
  // A site row's empty list beats the global one.
  assert.deepEqual(await hint_selectors_reply(storage_of(compiled), "https://bare.test/"), {});
  assert.deepEqual(await hint_selectors_reply(storage_of(compiled), "https://embed.test/"), { hint_add: [".card"] });
  assert.equal((await ask(compiled, "https://top.test/"))!.site_values, undefined);
  assert.deepEqual(await hint_selectors_reply(storage_of(undefined), "https://top.test/"), {});
  // An empty list is the default, so a fresh array of it stays out of the stored keymap.
  assert.equal("frame_site_globals" in compile_keymap(KEYMAP, { hint_add: [], hint_remove: [] }, resolve).compiled, false);
});

test("the strip rule is the global list on by default, none where a site row turns it off, and the list only where a row turns it on under a global off", async () => {
  const { strip_patterns_for } = await import("../src/background/strip_patterns.ts");
  const stored = (settings: Record<string, unknown>, list?: string[]) => ({ get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: compile_keymap(KEYMAP, settings, resolve).compiled, [CONFIG_STATUS_STORAGE_KEY]: { settings: list === undefined ? {} : { strip_tracking_params: list } } }) }) as never;
  const shipped = (await strip_patterns_for(stored({}), "https://a.test/p")) as string[];
  assert.ok(shipped.includes("utm_*"));
  const all_except = stored({ site_rules: [{ site: "https://off.test/*", strip_tracking: false }] }, ["utm_*"]);
  assert.deepEqual(await strip_patterns_for(all_except, "https://a.test/"), ["utm_*"]);
  assert.deepEqual(await strip_patterns_for(all_except, "https://off.test/x"), []);
  const none_except = stored({ strip_tracking: false, site_rules: [{ site: "https://on.test/*", strip_tracking: true }] }, ["utm_*"]);
  assert.deepEqual(await strip_patterns_for(none_except, "https://a.test/"), []);
  assert.deepEqual(await strip_patterns_for(none_except, "https://on.test/x"), ["utm_*"]);
  // An empty list strips nothing, even on a site row that turns the setting on.
  assert.deepEqual(await strip_patterns_for(stored({ site_rules: [{ site: "https://on.test/*", strip_tracking: true }] }, []), "https://on.test/"), []);
  // Nothing compiled yet keeps the default: on.
  assert.deepEqual(await strip_patterns_for({ get: async () => ({}) } as never, "https://a.test/"), shipped);
  assert.deepEqual(compile_keymap(KEYMAP, { strip_tracking: false }, resolve).compiled.frame_site_globals, { strip_tracking: false });
  assert.equal("frame_site_globals" in compile_keymap(KEYMAP, {}, resolve).compiled, false);
});

test("the rule is idle only when the global value is off or auto and no site row asks for a quality", async () => {
  const is_idle = (settings: Record<string, unknown>) => media_quality_is_idle(storage_of(compile_keymap(KEYMAP, settings, resolve).compiled));
  assert.equal(await is_idle({}), true, "the default auto leaves every player alone");
  assert.equal(await is_idle({ media_quality: "auto" }), true);
  assert.equal(await is_idle({ media_quality: "max" }), false, "an explicit max, written at its old default, is kept");
  assert.equal(await is_idle({ media_quality: "auto", site_rules: [{ site: "https://a.test/*", media_quality: "max" }] }), false, "a row that asks for a quality injects under the default");
  assert.equal(await is_idle({ media_quality: "off" }), true);
  assert.equal(await is_idle({ media_quality: "off", site_rules: [{ site: "https://a.test/*", media_quality: "off" }] }), true, "an off row asks for nothing under an idle global");
  assert.equal(await is_idle({ media_quality: "auto", site_rules: [{ site: "https://a.test/*", media_quality: "auto" }, { site: "https://b.test/*", media_quality: "off" }] }), true, "so does an auto row");
  assert.equal(await is_idle({ media_quality: "max", site_rules: [{ site: "https://a.test/*", media_quality: "auto" }] }), false, "under a global max an auto row still injects so the reply can say auto");
  assert.equal(await is_idle({ media_quality: "off", site_rules: [{ site: "https://a.test/*", media_quality: 720 }] }), false);
  assert.equal(await is_idle({ media_quality: "off", site_rules: [{ site: "https://a.test/*", off: true }] }), true);
  assert.equal(await media_quality_is_idle(storage_of(undefined)), true, "no stored keymap keeps the default auto");
});

test("the media_quality rule is auto by default, a site value overrides the global one, and off is a value", async () => {
  const reply = (settings: Record<string, unknown>, address: string) => media_quality_reply(storage_of(compile_keymap(KEYMAP, settings, resolve).compiled), address);
  assert.equal(await reply({}, "https://a.test/"), "auto");
  assert.equal(await reply({ media_quality: "max" }, "https://a.test/"), "max");
  const rows = { site_rules: [{ site: "https://a.test/*", media_quality: "auto" as const }, { site: "https://b.test/*", media_quality: 720 as const }, { site: "https://c.test/*", media_quality: "off" as const }] };
  assert.equal(await reply(rows, "https://a.test/watch"), "auto");
  assert.equal(await reply(rows, "https://b.test/"), "720");
  assert.equal(await reply(rows, "https://c.test/"), "off");
  assert.equal(await reply(rows, "https://other.test/"), "auto");
  // A site value beats a global off, and a row at the default (auto) still beats it.
  assert.equal(await reply({ media_quality: "off", site_rules: [{ site: "https://a.test/*", media_quality: "auto" }] }, "https://a.test/"), "auto");
  assert.equal(await reply({ media_quality: "off", site_rules: rows.site_rules }, "https://other.test/"), "off");
  // A frame resolves against its own address, and a page with no compiled keymap keeps the default.
  assert.equal(await media_quality_reply(storage_of(undefined), "https://a.test/"), "auto");
  assert.equal(await media_quality_reply(storage_of(compile_keymap(KEYMAP, rows, resolve).compiled), undefined), "auto");
  assert.equal((await ask(compile_keymap(KEYMAP, rows, resolve).compiled, "https://a.test/"))!.site_values, undefined);
});

test("a tab-wide value resolves against the top frame's address in every frame", () => {
  assert.equal(top_frame_address_of({ frameId: 0, url: "https://top.test/", tab: { url: "https://old.test/" } }), "https://top.test/");
  assert.equal(top_frame_address_of({ frameId: 3, url: "https://embed.test/", tab: { url: "https://top.test/" } }), "https://top.test/");
});

test("no stored keymap and an old format version both answer undefined", async () => {
  assert.equal(await ask(undefined, "https://a.test/"), undefined);
  assert.equal(await ask({ ...compile([]), format_version: 5 } as unknown as CompiledKeymap, "https://a.test/"), undefined);
});

test("the top frame matches on its own address, never on a tab address that lags", async () => {
  const compiled = compile([{ site: "https://old.test/*", pass: "j" }]);
  const top = rule_addresses_of({ frameId: 0, url: "https://new.test/", tab: { url: "https://old.test/" } });
  assert.deepEqual(top, ["https://new.test/"]);
  assert.equal((await page_keymap_for(storage_of(compiled), top))!.frees, undefined);
});

test("a subframe also matches on the tab address", async () => {
  const compiled = compile([{ site: "https://top.test/*", pass: "j" }]);
  const frame = rule_addresses_of({ frameId: 7, url: "https://embed.test/", tab: { url: "https://top.test/page" } });
  assert.deepEqual((await page_keymap_for(storage_of(compiled), frame))!.frees?.tokens, ["j"]);
});

// What the content script did before the background took over, kept here as the reference the new shape must equal.
const old_rule_frees = (rule: KeyRule, token: string): boolean =>
  "pass" in rule ? rule.pass.some((sequence) => sequence.length === 1 && sequence[0] === token) : ![...rule.only, ["<C-v>"], ["<S-Escape>"]].some((sequence) => sequence[0] === token);

test("frees_of frees the same keys as the old per-key rule", () => {
  const rules: KeyRule[] = [{ pass: [["j"], ["g", "g"], ["/"]] }, { pass: [] }, { only: [["j"], ["g", "g"]] }, { only: [] }, { only: [["<C-v>"]] }];
  const tokens = ["j", "k", "g", "/", "'", "0", "5", "9", "<C-v>", "<S-Escape>", "<Escape>", "<Space>", "x"];
  for (const rule of rules) for (const token of tokens) assert.equal(is_freed(frees_of(rule), token), old_rule_frees(rule, token), `${JSON.stringify(rule)} ${token}`);
});

function make_flow() {
  const state = create_mode_state();
  const ran: string[] = [];
  const flow = create_key_flow({
    in_editable_field_: () => false,
    escape_to_page_: () => false,
    get_mode_: state.get_mode_,
    take_pass_next_: state.take_pass_next_,
    run_leaf_: (matched) => ran.push(String(matched.steps[0]?.invocation.id)),
    leave_insert_: () => state.escape(),
    is_loading_: () => false,
    loading_sink_bundles_: () => [],
    sink_of_: () => undefined,
    on_prefix_: () => {},
  });
  return { ran, flow };
}

const install_into = (flow: ReturnType<typeof make_flow>["flow"]) => (reply: PageKeymap | undefined) => {
  const frees = reply?.frees;
  flow.set_matcher_(create_matcher({ ...compile([]), ...reply?.keymap, modes: reply?.keymap.modes ?? {} }, frees && ((token) => is_freed(frees, token))));
};

test("keys pressed before the reply stay held, then replay against the page's trimmed tree", async () => {
  const { ran, flow } = make_flow();
  const compiled = compile([{ site: "https://a.test/*", pass: "<Space> j" }]);
  assert.equal(flow.handle_token_("<Space>"), "cancel");
  assert.equal(flow.handle_token_("j"), "cancel");
  assert.equal(flow.handle_token_("k"), "cancel");
  assert.deepEqual(ran, []);
  install_into(flow)((await ask(compiled, "https://a.test/"))!);
  assert.deepEqual(ran, ["a.k"]);
});

test("the same held keys run on a page without the rule", async () => {
  const { ran, flow } = make_flow();
  flow.handle_token_("j");
  install_into(flow)((await ask(compile([{ site: "https://a.test/*", pass: "j" }]), "https://b.test/"))!);
  assert.deepEqual(ran, ["a.j"]);
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("a rejected ask is retried and the first reply installs", async () => {
  let sends = 0;
  const installed: unknown[] = [];
  const run = create_keymap_asks(async () => (++sends < 4 ? Promise.reject(new Error("Receiving end does not exist")) : "tree"), (reply) => installed.push(reply), 0);
  await run();
  assert.equal(sends, 4);
  assert.deepEqual(installed, ["tree"]);
});

test("after 30 rejected asks the page gets the empty tree, and a later ask heals it", async () => {
  let sends = 0;
  let up = false;
  const installed: unknown[] = [];
  const run = create_keymap_asks(async () => (up ? "tree" : (sends++, Promise.reject(new Error("down")))), (reply) => installed.push(reply), 0);
  await run();
  assert.equal(sends, 30);
  assert.deepEqual(installed, [undefined]);
  up = true;
  await run();
  assert.deepEqual(installed, [undefined, "tree"]);
});

test("the retry waits 100 ms between asks", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let sends = 0;
  const run = create_keymap_asks(async () => (++sends < 3 ? Promise.reject(new Error("down")) : "tree"), () => {});
  const running = run();
  await settle();
  assert.equal(sends, 1);
  context.mock.timers.tick(99);
  await settle();
  assert.equal(sends, 1);
  context.mock.timers.tick(1);
  await settle();
  assert.equal(sends, 2);
  context.mock.timers.tick(100);
  await running;
  assert.equal(sends, 3);
});

test("an empty reply is an answer, not a failure, so it is not retried", async () => {
  let sends = 0;
  const installed: unknown[] = [];
  await create_keymap_asks(async () => (sends++, undefined), (reply) => installed.push(reply), 0)();
  assert.equal(sends, 1);
  assert.deepEqual(installed, [undefined]);
});

test("a tree_updated ask that overtakes one in flight wins, and the stale reply is dropped", async () => {
  const pending: ((reply: string) => void)[] = [];
  const installed: string[] = [];
  const run = create_keymap_asks(() => new Promise<string>((resolve) => pending.push(resolve)), (reply) => installed.push(String(reply)), 0);
  const first = run();
  const second = run();
  pending[1]!("new");
  await second;
  pending[0]!("stale");
  await first;
  assert.deepEqual(installed, ["new"]);
});

test("an ask that a newer one overtook stops retrying", async () => {
  const sends: string[] = [];
  let fail = true;
  const run = create_keymap_asks(async () => {
    sends.push(fail ? "fail" : "ok");
    return fail ? Promise.reject(new Error("down")) : "tree";
  }, () => {}, 0);
  const first = run();
  fail = false;
  await run();
  await first;
  assert.equal(sends.length, 2);
});

test("the reply crosses as a JSON string that parses back to the page's keymap", async () => {
  const compiled = compile([{ site: "https://a.test/*", pass: "j" }]);
  const sent = await read_keymap_reply(storage_of(compiled), ["https://a.test/"]);
  assert.equal(typeof sent, "string");
  assert.deepEqual(JSON.parse(sent!), await ask(compiled, "https://a.test/"));
  assert.equal(await read_keymap_reply(storage_of(undefined), ["https://a.test/"]), undefined);
});

// The shipped rows, compiled with the real registry and default keymap, and the tree a page then gets.
const SHEETS = "https://docs.google.com/spreadsheets/d/abc/edit";
const SHEETS_DOMAIN = "https://docs.google.com/a/example.org/spreadsheets/d/abc/edit";
function with_defaults(settings: Record<string, unknown>) {
  const { compiled, warnings } = compile_config({ config: { ...empty_config(), settings: settings as never }, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} });
  assert.deepEqual(warnings, []);
  return compiled;
}
const key_at = async (compiled: CompiledKeymap, url: string, key: string) => {
  const leaf = (await ask(compiled, url))!.keymap.modes.normal?.children[key];
  return leaf?.kind === "leaf" ? (leaf.steps[0]?.invocation.args as Record<string, unknown> | undefined)?.key ?? leaf.steps[0]?.invocation.id : undefined;
};

test("the shipped sheets rows bind hjkl to the arrow keys on both address forms and on no other page", async () => {
  const compiled = with_defaults({});
  for (const url of [SHEETS, SHEETS_DOMAIN]) {
    assert.deepEqual(await Promise.all(["h", "j", "k", "l"].map((key) => key_at(compiled, url, key))), ["ArrowLeft", "ArrowDown", "ArrowUp", "ArrowRight"], url);
  }
  for (const url of ["https://docs.google.com/document/d/abc/edit", "https://sheets.google.com/spreadsheets/d/abc", "https://example.org/spreadsheets/d/abc"]) {
    assert.notEqual(await key_at(compiled, url, "j"), "ArrowDown", url);
  }
});

test("the shipped sheets rows bind gg and Ctrl+hjkl to Ctrl keys and free Ctrl+A and Ctrl+X", async () => {
  const compiled = with_defaults({});
  for (const url of [SHEETS, SHEETS_DOMAIN]) {
    const tree = (await ask(compiled, url))!;
    const sent = (key: string) => {
      const leaf = tree.keymap.modes.normal?.children[key];
      const args = leaf?.kind === "leaf" ? (leaf.steps[0]?.invocation.args as Record<string, unknown>) : undefined;
      return args && [args.key, args.ctrl];
    };
    assert.deepEqual(["<C-h>", "<C-j>", "<C-k>", "<C-l>"].map(sent), [["ArrowLeft", true], ["ArrowDown", true], ["ArrowUp", true], ["ArrowRight", true]], url);
    const g = tree.keymap.modes.normal?.children["g"];
    const gg = g?.kind === "branch" ? g.children["g"] : undefined;
    assert.deepEqual(gg?.kind === "leaf" ? [gg.steps[0]?.invocation.args?.key, gg.steps[0]?.invocation.args?.ctrl] : undefined, ["Home", true], url);
    assert.deepEqual(g?.kind === "branch" ? ["u", "i"].map((key) => key in g.children) : undefined, [true, true], url);
    assert.equal(tree.keymap.modes.normal?.children["<C-a>"], undefined, url);
    assert.equal(tree.keymap.modes.normal?.children["<C-x>"], undefined, url);
    assert.equal(tree.frees?.tokens.includes("<C-a>"), true, url);
    assert.equal(tree.keymap.modes.normal?.children["<C-v>"], undefined, url);
    assert.equal(tree.frees?.tokens.includes("<C-v>"), true, url);
  }
  assert.equal(await key_at(compiled, "https://example.org/", "<C-a>"), "url.increment");
});

test("the shipped sheets rows bind x and p to cut and paste on the grid editor, and other pages keep their x and p keys", async () => {
  const compiled = with_defaults({});
  for (const url of [SHEETS, SHEETS_DOMAIN]) {
    const tree = (await ask(compiled, url))!;
    const leaf = (key: string) => {
      const node = tree.keymap.modes.normal?.children[key];
      return node?.kind === "leaf" ? node.steps[0]?.invocation : undefined;
    };
    assert.deepEqual([leaf("x")?.id, leaf("x")?.args], ["page.clipboard", { action: "cut", target: "#waffle-rich-text-editor" }], url);
    assert.deepEqual([leaf("p")?.id, leaf("p")?.args], ["page.clipboard", { action: "paste", target: "#waffle-rich-text-editor" }], url);
  }
  const plain = (await ask(compiled, "https://example.org/"))?.keymap ?? compiled;
  assert.equal(plain.modes.normal?.children["x"]?.kind, "branch");
  assert.equal(plain.modes.normal?.children["p"]?.kind, "branch");
});

test("the shipped sheets rows turn escape_to_page and the parked cell editor rule on, a user row beats it, and no other page gets it", async () => {
  const compiled = with_defaults({});
  for (const url of [SHEETS, SHEETS_DOMAIN]) assert.deepEqual((await ask(compiled, url))!.site_values, { escape_to_page: true, editable_remove: ["#waffle-rich-text-editor"], editable_remove_unsized: true }, url);
  assert.equal((await ask(compiled, "https://docs.google.com/document/d/abc/edit"))!.site_values, undefined);
  const user = with_defaults({ site_rules: [{ site: "https://docs.google.com/spreadsheets/*", escape_to_page: false }] });
  assert.deepEqual((await ask(user, SHEETS))!.site_values, { editable_remove: ["#waffle-rich-text-editor"], editable_remove_unsized: true });
  assert.equal(await key_at(user, SHEETS, "j"), "ArrowDown");
});

test("the default insert keymap binds <A-Escape> to send Escape to the focused element", () => {
  const leaf = with_defaults({}).modes.insert?.children["<A-Escape>"];
  assert.equal(leaf?.kind, "leaf");
  const invocation = leaf?.kind === "leaf" ? leaf.steps[0]!.invocation : undefined;
  assert.deepEqual([invocation?.id, invocation?.args], ["page.send_key", { key: "Escape", key_code: 27, target: "", times: 1, ctrl: false, shift: false, alt: false, meta: false, keypress: false, focus: false }]);
});

test("default_site_rows_off turns off both sheets rows", async () => {
  const compiled = with_defaults({ default_site_rows_off: ["sheets"] });
  assert.deepEqual(compiled.site_rules?.map((rule) => rule.origin === "default" && rule.name), ["maps", "maps", "arrow", "google_images", "google_images", "google_videos", "google_videos", "google_videos", "google_videos", "google_news", "google_news", "google_short_videos", "google_short_videos", "google_shopping", "google_shopping", "ddg_images", "ddg_videos", "ddg_news", "ddg", "kagi", "brave", "google", "bing", "hackernews", "wikipedia", "wikipedia", "lobsters", "lobsters", "lobsters", "lobsters", "lobsters", "lobsters", "lobsters", "lobsters", "lobsters", "archwiki", "startpage", "arxiv", "stackoverflow", "tildes", "reddit", "reddit", "drive"]);
  for (const url of [SHEETS, SHEETS_DOMAIN]) assert.notEqual(await key_at(compiled, url, "j"), "ArrowDown");
  assert.equal(with_defaults({ default_site_rows_off: ["other"] }).site_rules?.length, 45);
});

test("the parked cell editor rule leaves with default_site_rows_off, and a user editable_remove replaces the shipped list", async () => {
  const off = with_defaults({ default_site_rows_off: ["sheets"] });
  for (const url of [SHEETS, SHEETS_DOMAIN]) assert.equal((await ask(off, url))?.site_values, undefined, url);
  const user = with_defaults({ site_rules: [{ site: "https://docs.google.com/spreadsheets/*", editable_remove: [".other"] }] });
  assert.deepEqual((await ask(user, SHEETS))!.site_values, { escape_to_page: true, editable_remove: [".other"], editable_remove_unsized: true });
});

test("a user bind for one key beats the shipped key and the other shipped keys stay", async () => {
  const user = { site: "https://docs.google.com/spreadsheets/*", bind: { j: { id: "page.send_key", args: { key: "PageDown", key_code: 34 } } } };
  const compiled = with_defaults({ site_rules: [user] });
  assert.deepEqual(await Promise.all(["h", "j", "k", "l"].map((key) => key_at(compiled, SHEETS, key))), ["ArrowLeft", "PageDown", "ArrowUp", "ArrowRight"]);
  assert.equal(await key_at(compiled, SHEETS_DOMAIN, "j"), "ArrowDown");
});

test("a user row that sets only pass leaves the shipped bind, and pass of a bound key frees it", async () => {
  const compiled = with_defaults({ site_rules: [{ site: "https://docs.google.com/spreadsheets/*", pass: "h" }] });
  assert.equal(await key_at(compiled, SHEETS, "j"), "ArrowDown");
  assert.equal(await key_at(compiled, SHEETS, "h"), undefined);
  assert.equal((await ask(compiled, SHEETS))!.frees?.tokens.includes("h"), true);
});

test("a user off row beats the shipped bind", async () => {
  const compiled = with_defaults({ site_rules: [{ site: "https://docs.google.com/*", off: true }] });
  const reply = (await ask(compiled, SHEETS))!;
  assert.equal(reply.all_off, true);
  assert.notEqual(await key_at(compiled, SHEETS, "j"), "ArrowDown");
});

test("the names constant lists exactly the names of the shipped rows", () => {
  assert.deepEqual([...new Set(DEFAULT_SITE_ROWS.map(({ name }) => name))], [...DEFAULT_SITE_ROW_NAMES]);
});

test("the shipped sheets rows bind G to Ctrl+End then Home, labeled, on both address forms, and default_site_rows_off removes it", async () => {
  for (const url of [SHEETS, SHEETS_DOMAIN]) {
    const leaf = (await ask(with_defaults({}), url))!.keymap.modes.normal?.children["G"];
    assert.equal(leaf?.kind, "leaf", url);
    if (leaf?.kind !== "leaf") continue;
    assert.equal(leaf.label, "Bottom of column A");
    assert.deepEqual(leaf.steps.map((step) => [step.invocation.id, step.invocation.args?.key, step.invocation.args?.key_code, step.invocation.args?.ctrl]), [["page.send_key", "End", 35, true], ["page.send_key", "Home", 36, false]], url);
  }
  assert.equal(await key_at(with_defaults({}), "https://example.org/", "G"), "scroll.to");
  assert.equal(await key_at(with_defaults({ default_site_rows_off: ["sheets"] }), SHEETS, "G"), "scroll.to");
});

test("the reply carries the mode a frame joins, insert beats media, and an all-off frame gets none", async () => {
  const on = compile([]);
  const storage = storage_of(on);
  const join_of = async (join: () => Promise<"insert" | "media" | undefined>, compiled = storage) => (await page_keymap_for(compiled, ["https://a.test/"], undefined, join))?.join;
  assert.equal(await join_of(async () => "media"), "media");
  assert.equal(await join_of(async () => "insert"), "insert");
  assert.equal(await join_of(async () => undefined), undefined);
  let asked = 0;
  const counted = async () => (asked++, "media" as const);
  assert.equal(await join_of(counted, storage_of(compile([{ site: "https://a.test/*" }]))), undefined);
  assert.equal(await join_of(counted, storage_of(compile([{ site: "https://a.test/*" }]))), undefined);
  assert.equal(asked, 0, "join is never asked for an all-off frame");
});

test("join_mode: insert beats media, media is not asked when insert holds, and a re-ask asks nothing", async () => {
  let asked = 0;
  const media = async () => (asked++, true);
  assert.equal(await join_mode(true, async () => true, media), "insert");
  assert.equal(asked, 0);
  assert.equal(await join_mode(true, async () => false, media), "media");
  assert.equal(await join_mode(true, async () => false, async () => false), undefined);
  asked = 0;
  assert.equal(await join_mode(false, async () => (asked++, true), media), undefined);
  assert.equal(asked, 0);
});

test("a tab opened under the default auto gets no probe, and switching to max reaches it with no navigation, and back to auto stops it", async () => {
  let settings: Record<string, unknown> = {};
  const is_idle = () => media_quality_is_idle(storage_of(compile_keymap(KEYMAP, settings, resolve).compiled));
  const probed: number[] = [];
  const bundled: number[] = [];
  const quality = create_media_quality({
    is_idle,
    inject_all: async (tab_id) => void probed.push(tab_id),
    inject_about_blank: async () => undefined,
    inject_frame: async (tab_id) => void bundled.push(tab_id),
    frame_address: async () => "https://a.test/",
    wait: async () => undefined,
    settle_ms: 0,
  });
  const tabs = async () => [{ id: 1, url: "https://a.test/" }];
  await quality.settings_changed(tabs);
  await quality.tab_updated(1, { url: "https://a.test/" }, "https://a.test/");
  await quality.tab_updated(1, { status: "complete" }, "https://a.test/");
  assert.equal(await quality.probe_reported(1, 0, "https://a.test/"), false);
  assert.deepEqual([probed, bundled], [[], []], "auto skips the probe and refuses a report");
  settings = { media_quality: "max" };
  await quality.settings_changed(tabs);
  assert.deepEqual(probed, [1], "the open tab is probed at the switch");
  assert.equal(await quality.probe_reported(1, 0, "https://a.test/"), true);
  assert.deepEqual(bundled, [1]);
  settings = { media_quality: "auto" };
  await quality.settings_changed(tabs);
  await quality.tab_updated(1, { url: "https://a.test/next" }, "https://a.test/next");
  assert.deepEqual(probed, [1], "back to auto injects nothing more");
  settings = { media_quality: "max" };
  await quality.settings_changed(tabs);
  assert.deepEqual(probed, [1, 1], "and max again reaches the tab again");
});

test("a site row auto under a global max answers auto, which the rule treats as hands-off", async () => {
  const compiled = compile_keymap(KEYMAP, { media_quality: "max", site_rules: [{ site: "https://a.test/*", media_quality: "auto" }] }, resolve).compiled;
  assert.equal(await media_quality_reply(storage_of(compiled), "https://a.test/"), "auto");
  assert.equal(await media_quality_reply(storage_of(compiled), "https://b.test/"), "max");
});

test("the search rows: kagi passes j and k, ddg binds them to page.item, brave binds them to arrow keys, and each row compiles on its engine only", async () => {
  const compiled = with_defaults({});
  const names = compiled.site_rules?.map((rule) => rule.origin === "default" && rule.name);
  for (const name of ["ddg", "kagi", "brave"]) assert.ok(names?.includes(name), `${name} row missing from the compiled rows`);
  for (const url of ["https://kagi.com/search?q=cats"]) {
    const reply = (await ask(compiled, url))!;
    assert.equal(reply.keymap.modes.normal?.children.j, undefined, `j still bound on ${url}`);
    assert.equal(reply.keymap.modes.normal?.children.k, undefined, `k still bound on ${url}`);
    assert.notEqual(reply.keymap.modes.normal?.children.h, undefined, `h freed on ${url}`);
  }
  for (const url of ["https://duckduckgo.com/?q=cats", "https://duckduckgo.com/?ia=web&origin=funnel_home_website&t=h_&q=cats"]) {
    for (const key of ["j", "k"]) assert.equal(await key_at(compiled, url, key), "page.item", `${key} on ${url}`);
    assert.notEqual((await ask(compiled, url))!.keymap.modes.normal?.children.h, undefined, `h freed on ${url}`);
  }
  for (const url of ["https://duckduckgo.com/settings", "https://duckduckgo.com/duckduckgo-help-pages/"]) assert.notEqual(await key_at(compiled, url, "j"), "page.item", `j is plain scroll on ${url}`);
  const brave = "https://search.brave.com/search?q=cats";
  assert.equal(await key_at(compiled, brave, "j"), "ArrowDown");
  assert.equal(await key_at(compiled, brave, "k"), "ArrowUp");
  for (const url of ["https://duckduckgo.com/?q=cats", "https://example.test/"]) assert.notEqual(await key_at(compiled, url, "j"), "ArrowDown");
  assert.equal(with_defaults({ default_site_rows_off: ["ddg", "kagi", "brave"] }).site_rules?.length, 42);
});

const item_args_at = async (compiled: CompiledKeymap, url: string, key: string) => {
  const leaf = (await ask(compiled, url))!.keymap.modes.normal?.children[key];
  const step = leaf?.kind === "leaf" ? leaf.steps[0] : undefined;
  return step?.invocation.id === "page.item" ? (step.invocation.args as { selector: string; direction: string }) : undefined;
};

test("the image row gives hjkl to the tiles on the DuckDuckGo image vertical and wins over the web row there", async () => {
  const compiled = with_defaults({});
  for (const url of ["https://duckduckgo.com/?q=cats&iax=images&ia=images", "https://duckduckgo.com/?iax=images&ia=images&q=cats"]) {
    const rows = await Promise.all(["h", "j", "k", "l"].map((key) => item_args_at(compiled, url, key)));
    assert.deepEqual(rows.map((args) => args?.direction), ["left", "down", "up", "right"], url);
    assert.ok(rows.every((args) => args?.selector === "figure"), `the tile selector on ${url}`);
  }
  // The web results keep their articles and no h or l.
  assert.match((await item_args_at(compiled, "https://duckduckgo.com/?q=cats&ia=web", "j"))!.selector, /data-testid/);
  assert.equal(await item_args_at(compiled, "https://duckduckgo.com/?q=cats", "l"), undefined);
  // The Google image tab wins over the web row at either end of the udm value, and udm=21 or a web search keeps the web row.
  for (const url of ["https://www.google.com/search?q=cats&udm=2", "https://www.google.com/search?udm=2&q=cats"]) {
    const rows = await Promise.all(["h", "j", "k", "l"].map((key) => item_args_at(compiled, url, key)));
    assert.deepEqual(rows.map((args) => args?.direction), ["left", "down", "up", "right"], url);
    assert.ok(rows.every((args) => args?.selector === 'div[data-attrid="images universal"]'), url);
  }
  for (const url of ["https://www.google.com/search?q=cats", "https://www.google.com/search?q=cats&udm=21"]) {
    assert.match((await item_args_at(compiled, url, "j"))!.selector, /MjjYud/, url);
    assert.equal(await item_args_at(compiled, url, "h"), undefined, url);
  }
  assert.match((await item_args_at(with_defaults({ default_site_rows_off: ["google_images"] }), "https://www.google.com/search?q=cats&udm=2", "j"))!.selector, /MjjYud/);
  const off = with_defaults({ default_site_rows_off: ["ddg_images"] });
  assert.match((await item_args_at(off, "https://duckduckgo.com/?q=cats&iax=images", "j"))!.selector, /data-testid/);
});

test("the search vertical rows win over the web rows on their tabs only, and each falls back to the web row when turned off", async () => {
  const compiled = with_defaults({});
  const GOOGLE_VIDEO = "#center_col div.MjjYud div[data-hveid]:has(a > h3):not(:has(div[data-hveid] a > h3))";
  const lists: [string, string][] = [
    ["https://www.google.com/search?q=cats&udm=7", GOOGLE_VIDEO],
    ["https://www.google.com/search?udm=7&q=cats", GOOGLE_VIDEO],
    ["https://www.google.com/search?q=cats&udm=vids", GOOGLE_VIDEO],
    ["https://www.google.com/search?udm=vids&q=cats", GOOGLE_VIDEO],
    ["https://duckduckgo.com/?q=cats&ia=news&iar=news", '[data-testid="news-vertical"] li > article'],
  ];
  for (const [url, selector] of lists) {
    for (const key of ["j", "k"]) assert.equal((await item_args_at(compiled, url, key))?.selector, selector, `${key} on ${url}`);
    assert.equal(await item_args_at(compiled, url, "h"), undefined, `h on ${url}`);
  }
  const grids: [string, string][] = [
    ["https://www.google.com/search?q=cats&tbm=nws", "#rso [data-news-doc-id]"],
    ["https://www.google.com/search?tbm=nws&q=cats", "#rso [data-news-doc-id]"],
    ["https://www.google.com/search?q=cats&udm=short_vids", "#center_col div.MjjYud:has(a[href])"],
    ["https://www.google.com/search?q=cats&udm=28", "[data-cid][data-pid]"],
    ["https://www.google.com/search?udm=28&q=cats", "[data-cid][data-pid]"],
    ["https://duckduckgo.com/?q=cats&ia=videos&iax=videos", '[data-testid="zci-videos"] a:has(> article)'],
  ];
  for (const [url, selector] of grids) {
    const rows = await Promise.all(["h", "j", "k", "l"].map((key) => item_args_at(compiled, url, key)));
    assert.deepEqual(rows.map((args) => args?.direction), ["left", "down", "up", "right"], url);
    assert.ok(rows.every((args) => args?.selector === selector), url);
  }
  // A udm value that only starts like a vertical's keeps the web row, and so do the Books and Forums tabs.
  for (const url of ["https://www.google.com/search?q=cats&udm=72", "https://www.google.com/search?q=cats&udm=280", "https://www.google.com/search?q=cats&udm=short_vids2", "https://www.google.com/search?q=cats&udm=books", "https://www.google.com/search?q=cats&udm=forums", "https://www.google.com/search?q=cats&tbm=nwsx"]) {
    assert.equal((await item_args_at(compiled, url, "j"))?.selector, "#search div.MjjYud:has(a > h3)", url);
  }
  for (const url of ["https://duckduckgo.com/?q=cats&ia=web", "https://duckduckgo.com/?q=cats&ia=news"]) assert.equal((await item_args_at(compiled, url, "j"))?.selector, 'article[data-testid="result"]', url);
  const fallbacks: [string, string, string][] = [
    ["google_videos", "https://www.google.com/search?q=cats&udm=7", "#search div.MjjYud:has(a > h3)"],
    ["google_news", "https://www.google.com/search?q=cats&tbm=nws", "#search div.MjjYud:has(a > h3)"],
    ["google_short_videos", "https://www.google.com/search?q=cats&udm=short_vids", "#search div.MjjYud:has(a > h3)"],
    ["google_shopping", "https://www.google.com/search?q=cats&udm=28", "#search div.MjjYud:has(a > h3)"],
    ["ddg_videos", "https://duckduckgo.com/?q=cats&ia=videos&iax=videos", 'article[data-testid="result"]'],
    ["ddg_news", "https://duckduckgo.com/?q=cats&ia=news&iar=news", 'article[data-testid="result"]'],
  ];
  for (const [name, url, selector] of fallbacks) assert.equal((await item_args_at(with_defaults({ default_site_rows_off: [name] }), url, "j"))?.selector, selector, name);
});

test("the list-page rows bind j and k to page.item on their result lists and leave story, question and other-host pages alone", async () => {
  const compiled = with_defaults({});
  const walks: [string, string][] = [
    ["https://lobste.rs/", "ol.stories > li.story"],
    ["https://lobste.rs/newest", "ol.stories > li.story"],
    ["https://lobste.rs/newest/page/2", "ol.stories > li.story"],
    ["https://lobste.rs/page/2", "ol.stories > li.story"],
    ["https://lobste.rs/recent", "ol.stories > li.story"],
    ["https://lobste.rs/recent/page/2", "ol.stories > li.story"],
    ["https://lobste.rs/top/1w", "ol.stories > li.story"],
    ["https://lobste.rs/domains/github.com", "ol.stories > li.story"],
    ["https://lobste.rs/active", "ol.stories > li.story"],
    ["https://lobste.rs/t/programming", "ol.stories > li.story"],
    ["https://lobste.rs/search?q=rust&what=stories", "ol.stories > li.story"],
    ["https://wiki.archlinux.org/index.php?search=pacman&fulltext=1", "li.mw-search-result"],
    ["https://wiki.archlinux.org/index.php?title=Special%3ASearch&search=pacman", "li.mw-search-result"],
    ["https://www.startpage.com/sp/search?query=cats", "div.result:has(a.result-title)"],
    ["https://arxiv.org/search/?query=cats&searchtype=all", "li.arxiv-result"],
    ["https://stackoverflow.com/questions", "div.s-post-summary"],
    ["https://stackoverflow.com/questions/tagged/rust", "div.s-post-summary"],
    ["https://tildes.net/", "article.topic"],
    ["https://tildes.net/~comp", "article.topic"],
    ["https://www.reddit.com/r/rust/new/?js_challenge=1", "shreddit-feed shreddit-post, shreddit-feed shreddit-profile-comment"],
    ["https://reddit.com/", "shreddit-feed shreddit-post, shreddit-feed shreddit-profile-comment"],
  ];
  for (const [url, selector] of walks) {
    for (const key of ["j", "k"]) assert.equal((await item_args_at(compiled, url, key))?.selector, selector, `${key} on ${url}`);
    assert.equal(await item_args_at(compiled, url, "h"), undefined, `h on ${url}`);
  }
  assert.equal(await item_args_at(compiled, "https://www.reddit.com/", "G").then((args) => args?.direction), "last");
  assert.equal(await item_args_at(compiled, "https://www.reddit.com/", "gg"), undefined, "gg is the plain scroll on reddit");
  const plain = [
    "https://lobste.rs/s/abc123/some_story",
    "https://lobste.rs/s/abc123/some_story/comments",
    "https://lobste.rs/u/someone",
    "https://wiki.archlinux.org/title/Pacman",
    "https://wiki.archlinux.org/index.php?title=Pacman&action=history",
    "https://www.startpage.com/",
    "https://arxiv.org/abs/2101.00001",
    "https://stackoverflow.com/",
    "https://stackoverflow.com/users/1/someone",
    "https://unix.stackexchange.com/questions",
    "https://example.test/questions",
    "https://example.test/search/",
  ];
  for (const url of plain) assert.equal(await item_args_at(compiled, url, "j"), undefined, `j is plain scroll on ${url}`);
  for (const name of ["lobsters", "archwiki", "startpage", "arxiv", "stackoverflow", "tildes", "reddit"]) {
    const off = with_defaults({ default_site_rows_off: [name] });
    assert.ok(off.site_rules!.length < compiled.site_rules!.length, name);
  }
  assert.equal(await item_args_at(with_defaults({ default_site_rows_off: ["tildes"] }), "https://tildes.net/", "j"), undefined);
});

// A request names the page's address now, which stands in for `sender.url`: that stays the load address after a pushState.
test("a request that names its address is matched on it, and the load address answers when it names none", () => {
  const sender = { url: "https://a.test/web", frameId: 0, tab: { id: 7, url: "https://a.test/web" } };
  const located = sender_at(sender, "https://a.test/images");
  assert.deepEqual(rule_addresses_of(located), ["https://a.test/images"]);
  assert.deepEqual(rule_addresses_of(sender_at(sender, undefined)), ["https://a.test/web"]);
  assert.deepEqual(rule_addresses_of(sender_at(sender, 5)), ["https://a.test/web"]);
  assert.deepEqual(rule_addresses_of(sender_at({ ...sender, frameId: 3 }, "https://a.test/images")), ["https://a.test/images", "https://a.test/web"]);
});

test("a request that names an address of another origin keeps the load address, as an about:blank frame that reports its parent's address", () => {
  const blank = { url: "about:blank", frameId: 2, tab: { id: 7, url: "https://a.test/web" } };
  assert.deepEqual(rule_addresses_of(sender_at(blank, "https://a.test/web")), ["about:blank", "https://a.test/web"]);
  const page = { url: "https://a.test/web", frameId: 0 };
  assert.deepEqual(rule_addresses_of(sender_at(page, "https://b.test/web")), ["https://a.test/web"]);
  assert.deepEqual(rule_addresses_of(sender_at(page, "not a url")), ["https://a.test/web"]);
  assert.equal(sender_at<{ url?: string }>({}, "not a url").url, undefined);
  assert.deepEqual(rule_addresses_of(sender_at(page, "https://a.test/images#x")), ["https://a.test/images#x"]);
});

test("the row for the new address decides the tree: off on one address, the keys back on the other", async () => {
  const compiled = compile([{ site: "https://a.test/off*" }]);
  assert.equal((await ask(compiled, "https://a.test/off"))?.all_off, true);
  assert.notEqual((await ask(compiled, "https://a.test/web"))?.all_off, true);
});

test("an older reply that lands after a newer ask began is dropped, across a burst of three asks", async () => {
  const pending: ((reply: string) => void)[] = [];
  const installed: string[] = [];
  const run = create_keymap_asks(() => new Promise<string>((resolve) => pending.push(resolve)), (reply) => installed.push(String(reply)), 0);
  const asks = [run(), run(), run()];
  pending[2]!("c");
  pending[0]!("a");
  pending[1]!("b");
  await Promise.all(asks);
  assert.deepEqual(installed, ["c"]);
});

test("the drive row focuses the current file and sends Drive's own key to it, binds gg and G to the item ends, and leaves list h and l to the plain scroll", async () => {
  const compiled = with_defaults({});
  const drive = "https://drive.google.com/drive/my-drive";
  const list = '[role="grid"] [role="row"][data-id]';
  const grid = '[role="grid"] [role="gridcell"][data-id]';
  const leaf_at = async (key: string) => {
    // gg sits under the g branch.
    let node: TreeNode | undefined = (await ask(compiled, drive))!.keymap.modes.normal;
    for (const token of key) node = node?.kind === "branch" ? node.children[token] : undefined;
    assert.equal(node?.kind, "leaf", key);
    return node as TreeLeaf;
  };
  for (const [key, guard, sent] of [["j", `${grid}, ${list}`, "ArrowDown"], ["k", `${grid}, ${list}`, "ArrowUp"], ["h", grid, "ArrowLeft"], ["l", grid, "ArrowRight"]] as const) {
    const leaf = await leaf_at(key);
    assert.equal(leaf.when_present, guard, key);
    const args = leaf.steps.map((step) => step.invocation.args as { selector?: string; direction?: string; key?: string; target?: string });
    assert.deepEqual([leaf.steps.map((step) => step.invocation.id), args[0]?.selector, args[0]?.direction, args[1]?.key, args[1]?.target], [["page.item", "page.send_key"], guard, "current", sent, ""], key);
  }
  // Drive ignores a sent Home and End, so gg and G go to the ends through page.item, which scrolls Drive's panel.
  for (const [key, direction] of [["gg", "first"], ["G", "last"]] as const) {
    const leaf = await leaf_at(key);
    assert.equal(leaf.when_present, `${grid}, ${list}`, key);
    assert.deepEqual([leaf.steps.map((step) => step.invocation.id), leaf.steps[0]?.invocation.args?.direction], [["page.item"], direction], key);
  }
  // A guard that fails falls through to the plain key: h and l scroll sideways in the list view.
  assert.equal((await leaf_at("h")).otherwise?.steps[0]?.invocation.id, "scroll.pixels");
  for (const url of ["https://docs.google.com/document/d/abc/edit", "https://drive.google.com/file/d/abc/view"]) assert.equal(await item_args_at(compiled, url, "j"), undefined, url);
  assert.equal(await item_args_at(with_defaults({ default_site_rows_off: ["drive"] }), drive, "j"), undefined);
});
