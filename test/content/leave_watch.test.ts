import assert from "node:assert/strict";
import { test } from "node:test";
import { arm_leave_watch, LEAVE_QUIET_MS, type NavigateEvent } from "../../src/content/page/leave_watch.ts";
import type { BundleHostApi } from "../../src/content/bundle_host.ts";

const HERE = "https://app.test/inbox";

const sent: unknown[] = [];
(globalThis as { browser?: unknown }).browser = { runtime: { sendMessage: async (message: unknown) => void sent.push(message) } };

// How a navigation ends, as Firefox 160 reports it (docs/firefox-behavior.md): a change within the document and one an app intercepts commit here, a cancelled one does not, and one that loads another document only hides this one.
type Outcome = "commit" | "intercept" | "cancel" | "load";

// One document: its window, its scroll box and the messages it sent.
function make(extra: { is_top?: boolean } = {}) {
  sent.length = 0;
  const state = { now: 10_000, y: 400 };
  const navigation = new EventTarget();
  const events = new EventTarget();
  const page = {
    location: { href: HERE },
    document: { hidden: false },
    performance: { now: () => state.now },
    navigation,
    addEventListener: events.addEventListener.bind(events),
    top: undefined as unknown,
  };
  page.top = extra.is_top === false ? {} : page;
  const host = { scroll_box_: () => ({ scrollLeft: 0, scrollTop: state.y }) } as unknown as BundleHostApi;
  const watch = arm_leave_watch(host, page as unknown as Window);
  const hide = () => events.dispatchEvent(new Event("pagehide"));
  // As Firefox runs it: `navigate` fires before the address changes and before the app draws its new view. The commit follows at once.
  const navigate = (url: string, type: NavigateEvent["navigationType"] = "push", outcome: Outcome = "commit") => {
    const event: NavigateEvent = { navigationType: type, hashChange: url.split("#")[0] === page.location.href.split("#")[0] && url !== page.location.href, destination: { url, sameDocument: outcome === "commit" || outcome === "cancel" } };
    navigation.dispatchEvent(Object.assign(new Event("navigate"), event));
    if (outcome === "cancel") return;
    if (outcome === "load") return hide();
    page.location.href = url;
    state.y = 0;
    navigation.dispatchEvent(new Event("currententrychange"));
  };
  return { watch, page, host, state, navigate, hide };
}

const pushed = (url: string, y: number) => ({ type: "jump_push", url, x: 0, y });

test("a push to another page sends the address left and the offset read as the change starts", () => {
  const { navigate } = make();
  navigate("https://app.test/mail/1");
  assert.deepEqual(sent, [pushed(HERE, 400)]);
});

test("a back or forward within the page records as a push does", () => {
  const { state, navigate } = make();
  navigate("https://app.test/mail/1");
  state.now += LEAVE_QUIET_MS;
  state.y = 250;
  navigate(HERE, "traverse");
  assert.deepEqual(sent, [pushed(HERE, 400), pushed("https://app.test/mail/1", 250)]);
});

test("a replace, a hash change, the same page, a reload and a new document record nothing", () => {
  const { navigate } = make();
  navigate("https://app.test/inbox?sorted", "replace");
  navigate("https://app.test/inbox?sorted#top");
  navigate("https://app.test/inbox?sorted", "push");
  navigate("https://app.test/inbox?sorted", "reload");
  navigate("https://app.test/other", "push", "cancel");
  assert.deepEqual(sent, []);
});

test("a burst of pushes records once, and a push after the quiet window records again", () => {
  const { state, navigate } = make();
  navigate("https://app.test/a");
  state.now += LEAVE_QUIET_MS - 1;
  navigate("https://app.test/b");
  assert.equal(sent.length, 1);
  state.now += 1;
  navigate("https://app.test/c");
  assert.deepEqual(sent.at(-1), pushed("https://app.test/b", 0));
});

test("a push within the quiet window after a jump or step scrolled the page records nothing", () => {
  const { watch, state, navigate } = make();
  watch.quiet_(true);
  state.now += LEAVE_QUIET_MS - 1;
  navigate("https://app.test/a");
  assert.deepEqual(sent, []);
  state.now += LEAVE_QUIET_MS;
  navigate("https://app.test/b");
  assert.equal(sent.length, 1);
});

test("a hidden tab records nothing", () => {
  const { page, navigate } = make();
  page.document.hidden = true;
  navigate("https://app.test/a");
  assert.deepEqual(sent, []);
});

test("a child frame records no push and no leave", () => {
  const { navigate, hide } = make({ is_top: false });
  navigate("https://app.test/a");
  hide();
  assert.deepEqual(sent, []);
});

test("the top frame reports its offset as the page hides", () => {
  const { hide } = make();
  hide();
  assert.deepEqual(sent, [{ type: "jump_leave", url: HERE, x: 0, y: 400 }]);
});

test("the page and hints bundles both arm: one listener per document, and both get the same watch", () => {
  const { watch, page, host, navigate, hide } = make();
  assert.equal(arm_leave_watch(host, page as unknown as Window), watch);
  navigate("https://app.test/a");
  hide();
  assert.deepEqual(sent, [pushed(HERE, 400), { type: "jump_leave", url: "https://app.test/a", x: 0, y: 0 }]);
});

test("a cancelled change records nothing, and a later replace does not commit it", () => {
  const { navigate } = make();
  navigate("https://app.test/a", "push", "cancel");
  navigate("https://app.test/a", "replace");
  assert.deepEqual(sent, []);
});

test("a cancelled change starts no quiet window, so the next move records", () => {
  const { navigate } = make();
  navigate("https://app.test/a", "push", "cancel");
  navigate("https://app.test/b");
  assert.deepEqual(sent, [pushed(HERE, 400)]);
});

test("a link an app intercepts records the place left, though its navigate named another document", () => {
  const { navigate } = make();
  navigate("https://app.test/mail/1", "push", "intercept");
  assert.deepEqual(sent, [pushed(HERE, 400)]);
});

test("a navigation that loads another document is left to the page hiding, which reports once", () => {
  const { navigate } = make();
  navigate("https://app.test/other", "push", "load");
  assert.deepEqual(sent, [{ type: "jump_leave", url: HERE, x: 0, y: 400 }]);
});

test("a hint pick ends the quiet window, so its change records right after a jump", () => {
  const { watch, navigate } = make();
  watch.quiet_(true);
  watch.quiet_(false);
  navigate("https://app.test/a");
  assert.deepEqual(sent, [pushed(HERE, 400)]);
});
