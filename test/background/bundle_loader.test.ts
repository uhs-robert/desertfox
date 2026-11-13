import assert from "node:assert/strict";
import { test } from "node:test";
import { create_bundle_loader } from "../../src/background/bundle_loader.ts";
import type { BundleTarget } from "../../src/background/bundle_loader.ts";

type Pending = { target: BundleTarget; file: string; route: "inject" | "page_tag"; settle: (error?: Error) => void };

// Each inject call waits until the test settles it, so the test controls the order of events.
function make_loader(timeout_ms = 1000) {
  const pending: Pending[] = [];
  const route = (kind: Pending["route"]) => (target: BundleTarget, file: string) =>
    new Promise<void>((resolve, reject) => {
      pending.push({ target, file, route: kind, settle: (error) => (error ? reject(error) : resolve()) });
    });
  const loader = create_bundle_loader({ timeout_ms, inject: route("inject"), add_script_tag: route("page_tag"), extension_origin: () => "moz-extension://abc/" });
  return { loader, pending };
}

const target = (overrides: Partial<BundleTarget> = {}): BundleTarget => ({ tab_id: 1, frame_id: 0, document_id: "doc_a", in_extension_page: false, ...overrides });
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("requests that arrive while a load runs join it, so the bundle is injected once", async () => {
  const { loader, pending } = make_loader();
  const first = loader.load(target(), "hints");
  const second = loader.load(target(), "hints");
  const third = loader.load(target(), "hints");
  assert.equal(pending.length, 1);
  assert.equal(pending[0]!.file, "hints.js");
  pending[0]!.settle();
  assert.deepEqual(await Promise.all([first, second, third]), [{ ok: true }, { ok: true }, { ok: true }]);
});

test("each tab, frame and bundle gets its own injection", async () => {
  const { loader, pending } = make_loader();
  const loads = [
    loader.load(target(), "hints"),
    loader.load(target({ tab_id: 2 }), "hints"),
    loader.load(target({ frame_id: 3 }), "hints"),
    loader.load(target(), "caret"),
  ];
  assert.deepEqual(pending.map((entry) => `${entry.target.tab_id}:${entry.target.frame_id}:${entry.file}`), ["1:0:hints.js", "2:0:hints.js", "1:3:hints.js", "1:0:caret.js"]);
  for (const entry of pending) entry.settle();
  assert.ok((await Promise.all(loads)).every((answer) => answer.ok));
});

test("a failed injection answers with a refusal and the next request tries again", async () => {
  const { loader, pending } = make_loader();
  const failed = loader.load(target(), "caret");
  pending[0]!.settle(new Error("frame is gone"));
  const answer = await failed;
  assert.equal(answer.ok, false);
  assert.match(answer.ok ? "" : answer.refusal.message, /could not load caret: frame is gone/);
  const retry = loader.load(target(), "caret");
  assert.equal(pending.length, 2);
  pending[1]!.settle();
  assert.deepEqual(await retry, { ok: true });
});

test("a page that navigates mid-load leaves nothing stuck: the new page injects on its own", async () => {
  const { loader, pending } = make_loader();
  const old_page = loader.load(target({ document_id: "old" }), "hints");
  const new_page = loader.load(target({ document_id: "new" }), "hints");
  assert.equal(pending.length, 2);
  pending[0]!.settle(new Error("no matching frame"));
  assert.equal((await old_page).ok, false);
  pending[1]!.settle();
  assert.deepEqual(await new_page, { ok: true });
});

test("an old page's load finishing late does not end the new page's load", async () => {
  const { loader, pending } = make_loader();
  const old_page = loader.load(target({ document_id: "old" }), "hints");
  const new_page = loader.load(target({ document_id: "new" }), "hints");
  pending[1]!.settle();
  assert.deepEqual(await new_page, { ok: true });
  pending[0]!.settle(new Error("late"));
  assert.equal((await old_page).ok, false);
});

test("an injection that never answers fails at the deadline and the next request tries again", async () => {
  const { loader, pending } = make_loader(20);
  const stuck = loader.load(target(), "hints");
  const joined = loader.load(target(), "hints");
  const [first, second] = await Promise.all([stuck, joined]);
  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  assert.match(first.ok ? "" : first.refusal.message, /no answer in 20 ms/);
  const retry = loader.load(target(), "hints");
  assert.equal(pending.length, 2);
  pending[1]!.settle();
  assert.deepEqual(await retry, { ok: true });
});

test("answer takes the tab, frame and document from the sender and checks the name", async () => {
  const { loader, pending } = make_loader();
  const asked = loader.answer({ tab: { id: 7 }, frameId: 4, documentId: "doc_z" }, "whichkey");
  assert.deepEqual(pending[0]!.target, { tab_id: 7, frame_id: 4, document_id: "doc_z", in_extension_page: false });
  pending[0]!.settle();
  assert.deepEqual(await asked, { ok: true });

  const unknown = await loader.answer({ tab: { id: 7 } }, "../background");
  const no_tab = await loader.answer({}, "hints");
  assert.equal(unknown.ok, false);
  assert.equal(no_tab.ok, false);
  await tick();
  assert.equal(pending.length, 1);
});

test("a request from an extension page asks the page for a script tag, and a website's goes to executeScript", async () => {
  const { loader, pending } = make_loader();
  const from_page = loader.answer({ url: "moz-extension://abc/home.html", tab: { id: 1 }, frameId: 0, documentId: "d" }, "text");
  const from_site = loader.answer({ url: "https://example.com/", tab: { id: 2 }, frameId: 0, documentId: "e" }, "text");
  const lookalike = loader.answer({ url: "https://example.com/moz-extension://abc/", tab: { id: 3 }, frameId: 0, documentId: "f" }, "text");
  assert.deepEqual(pending.map((entry) => entry.route), ["page_tag", "inject", "inject"]);
  for (const entry of pending) entry.settle();
  assert.ok((await Promise.all([from_page, from_site, lookalike])).every((answer) => answer.ok));
});

test("two requests for one bundle from an extension page ask for one tag and both resolve after it ran", async () => {
  const { loader, pending } = make_loader();
  const sender = { url: "moz-extension://abc/home.html", tab: { id: 1 }, frameId: 0, documentId: "d" };
  let resolved = 0;
  const first = loader.answer(sender, "editor").then((answer) => (resolved++, answer));
  const second = loader.answer(sender, "editor").then((answer) => (resolved++, answer));
  await tick();
  assert.equal(pending.length, 1);
  assert.equal(resolved, 0);
  pending[0]!.settle();
  assert.deepEqual(await Promise.all([first, second]), [{ ok: true }, { ok: true }]);
});

test("a tag that fails to load answers the could-not-load refusal, and a later request tries again", async () => {
  const { loader, pending } = make_loader();
  const sender = { url: "moz-extension://abc/home.html", tab: { id: 1 }, frameId: 0, documentId: "d" };
  const failed = loader.answer(sender, "text");
  pending[0]!.settle(new Error("text.js did not load"));
  const answer = await failed;
  assert.match(answer.ok ? "" : answer.refusal.message, /DesertFox could not load text: text.js did not load/);
  const retry = loader.answer(sender, "text");
  assert.equal(pending.length, 2);
  pending[1]!.settle();
  assert.deepEqual(await retry, { ok: true });
});
