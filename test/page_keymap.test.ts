import assert from "node:assert/strict";
import { test } from "node:test";
import { hint_selectors_reply, rule_addresses_of, page_keymap_for, read_keymap_reply, site_columns_for, site_value, top_frame_address_of } from "../src/background/page_keymap.ts";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/background/config_load.ts";
import "../src/background/command_modules.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import { DEFAULT_SITE_ROWS } from "../src/background/default_site_rows.ts";
import { DEFAULT_SITE_ROW_NAMES } from "../src/shared/table_constants.ts";
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

test("the shipped sheets rows turn escape_to_page on, a user row beats it, and no other page gets it", async () => {
  const compiled = with_defaults({});
  for (const url of [SHEETS, SHEETS_DOMAIN]) assert.deepEqual((await ask(compiled, url))!.site_values, { escape_to_page: true }, url);
  assert.equal((await ask(compiled, "https://docs.google.com/document/d/abc/edit"))!.site_values, undefined);
  const user = with_defaults({ site_rules: [{ site: "https://docs.google.com/spreadsheets/*", escape_to_page: false }] });
  assert.equal((await ask(user, SHEETS))!.site_values, undefined);
  assert.equal(await key_at(user, SHEETS, "j"), "ArrowDown");
});

test("the default insert keymap binds <A-Escape> to send Escape to the focused element", () => {
  const leaf = with_defaults({}).modes.insert?.children["<A-Escape>"];
  assert.equal(leaf?.kind, "leaf");
  const invocation = leaf?.kind === "leaf" ? leaf.steps[0]!.invocation : undefined;
  assert.deepEqual([invocation?.id, invocation?.args], ["page.send_key", { key: "Escape", key_code: 27, target: "", times: 1, ctrl: false, shift: false, alt: false, meta: false, keypress: false }]);
});

test("default_site_rows_off turns off both sheets rows", async () => {
  const compiled = with_defaults({ default_site_rows_off: ["sheets"] });
  assert.equal(compiled.site_rules, undefined);
  for (const url of [SHEETS, SHEETS_DOMAIN]) assert.notEqual(await key_at(compiled, url, "j"), "ArrowDown");
  assert.equal(with_defaults({ default_site_rows_off: ["other"] }).site_rules?.length, 2);
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
