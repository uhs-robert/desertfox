import assert from "node:assert/strict";
import { test } from "node:test";
import { create_bundle_host } from "../../src/content/bundle_host.ts";
import { create_which_key_timer } from "../../src/content/whichkey/timer.ts";
import type { PendingPrefix } from "../../src/content/key_flow.ts";

const DELAY_MS = 20;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const g: PendingPrefix = { mode: "normal", typed_: ["g"] };

// A host whose whichkey load the test settles, with the bundle's own timer behind the handler, as whichkey/main.ts wires it.
// The gate keeps one module flag per frame, so each page loads a fresh copy of the module.
let copies = 0;
async function make_page() {
  const { follow_which_key } = (await import(`../../src/content/whichkey/gate.ts?copy=${copies++}`)) as typeof import("../../src/content/whichkey/gate.ts");
  const host = create_bundle_host();
  let finish_load: (loaded: boolean) => void = () => {};
  let loads = 0;
  host.connect({
    request_bundle_: () => (loads++, new Promise<boolean>((resolve) => (finish_load = resolve))),
    on_idle_: () => {},
    hold_first_: () => {},
    set_mode_: () => {},
    show_error_: (message) => assert.fail(message),
  });
  const drawn: string[] = [];
  let delay: number | undefined;
  let skip: readonly string[] | undefined;
  const timer = create_which_key_timer(
    () => delay,
    (prefix) => void (prefix && drawn.push(prefix.typed_.join(""))),
    () => skip,
  );
  const register = () => host.api.register_handler_("whichkey", (args) => ((({ delay_ms: delay, skip } = args as { delay_ms?: number; skip?: string[] })), timer((args as { prefix?: PendingPrefix }).prefix, (args as { at_once?: boolean }).at_once)));
  const follow = (prefix: PendingPrefix | undefined, at_once?: boolean, settings: { delay_ms?: number; skip?: string[] } = { delay_ms: DELAY_MS }) => follow_which_key(host, prefix, at_once, settings.delay_ms, settings.skip);
  return { host, follow, register, drawn, loads: () => loads, finish: () => finish_load(true) };
}

test("a hide sent while the bundle is still loading cancels the panel the load starts", async () => {
  const page = await make_page();
  page.follow(g);
  page.follow(undefined);
  page.register();
  page.finish();
  await sleep(DELAY_MS * 3);
  assert.deepEqual(page.drawn, [], "a fast gg left a stale panel");
  assert.equal(page.loads(), 1);
});

test("a prefix that stays up draws after the load", async () => {
  const page = await make_page();
  page.follow(g);
  page.register();
  page.finish();
  await sleep(DELAY_MS * 3);
  assert.deepEqual(page.drawn, ["g"]);
});

test("nothing loads for a hide or a prefix while which-key is off", async () => {
  const page = await make_page();
  page.follow(undefined);
  page.follow(g, false, { delay_ms: 0 });
  page.follow(g, false, {});
  assert.equal(page.loads(), 0);
});

test("a first prefix in the skip list loads nothing, but an instant redraw does", async () => {
  const page = await make_page();
  page.follow(g, false, { delay_ms: DELAY_MS, skip: ["g"] });
  assert.equal(page.loads(), 0);
  page.follow(g, true, { delay_ms: DELAY_MS, skip: ["g"] });
  assert.equal(page.loads(), 1);
});

test("a bundle loaded by a manual panel still gets the prefix changes with the timer off", async () => {
  const page = await make_page();
  let calls = 0;
  page.host.api.register_handler_("whichkey", () => void calls++);
  page.follow(g, false, { delay_ms: 0 });
  page.follow(undefined, false, { delay_ms: 0 });
  await sleep(0);
  assert.equal(calls, 2);
  assert.equal(page.loads(), 0);
});
