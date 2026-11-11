import assert from "node:assert/strict";
import { test } from "node:test";
import { rule_addresses_of, page_keymap_for, read_keymap_reply, site_columns_for, site_value, top_frame_address_of } from "../src/background/page_keymap.ts";
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
  assert.equal(site_value(site_columns_for(compiled, ["https://a.test/"]), "zoom", 1.25), 2);
  assert.equal(site_value(site_columns_for(compiled, ["https://b.test/"]), "zoom", 1.25), 1.25);
  // A false or zero site value still wins.
  const falsy = compile([{ site: "https://a.test/*", flag: false }] as unknown as Parameters<typeof compile>[0]);
  assert.equal(site_value(site_columns_for(falsy, ["https://a.test/"]), "flag", true), false);
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
