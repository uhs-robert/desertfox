import assert from "node:assert/strict";
import { test } from "node:test";
import { arm_leave_watch, LEAVE_QUIET_MS, type NavigateEvent } from "../../src/content/page/leave_watch.ts";
import type { BundleHostApi } from "../../src/content/bundle_host.ts";

const HERE = "https://app.test/inbox";

const sent: unknown[] = [];
(globalThis as { browser?: unknown }).browser = { runtime: { sendMessage: async (message: unknown) => void sent.push(message) } };

// One document: its window, its scroll box and the messages it sent.
function make(extra: { is_top?: boolean } = {}) {
  sent.length = 0;
  const state = { now: 10_000, y: 400 };
  const navigation = new EventTarget();
  const events = new EventTarget();
  const page = {
    location: { href: HERE },
    document: { visibilityState: "visible" },
    performance: { now: () => state.now },
    navigation,
    addEventListener: events.addEventListener.bind(events),
    top: undefined as unknown,
  };
  page.top = extra.is_top === false ? {} : page;
  const host = { scroll_box_: () => ({ scrollLeft: 0, scrollTop: state.y }) } as unknown as BundleHostApi;
  const watch = arm_leave_watch(host, page as unknown as Window);
  // As Firefox runs it: the event fires before the address changes and before the app draws its new view.
  const navigate = (url: string, type: NavigateEvent["navigationType"] = "push", same_document = true) => {
    const event: NavigateEvent = { navigationType: type, hashChange: url.split("#")[0] === page.location.href.split("#")[0] && url !== page.location.href, destination: { url, sameDocument: same_document } };
    navigation.dispatchEvent(Object.assign(new Event("navigate"), event));
    if (same_document) page.location.href = url;
    state.y = 0;
  };
  const hide = () => events.dispatchEvent(new Event("pagehide"));
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
  navigate("https://app.test/other", "push", false);
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
  watch.quiet_now_();
  state.now += LEAVE_QUIET_MS - 1;
  navigate("https://app.test/a");
  assert.deepEqual(sent, []);
  state.now += LEAVE_QUIET_MS;
  navigate("https://app.test/b");
  assert.equal(sent.length, 1);
});

test("a hidden tab records nothing", () => {
  const { page, navigate } = make();
  page.document.visibilityState = "hidden";
  navigate("https://app.test/a");
  assert.deepEqual(sent, []);
});

test("a child frame records no push and no leave, but its listeners still hear its changes within the document", () => {
  const { watch, navigate, hide } = make({ is_top: false });
  const heard: string[] = [];
  watch.listen_((event) => heard.push(`${event.navigationType} ${event.destination.url}`));
  navigate("https://app.test/a");
  navigate("https://app.test/a#x");
  navigate("https://app.test/b", "push", false);
  hide();
  assert.deepEqual(sent, []);
  assert.deepEqual(heard, ["push https://app.test/a", "push https://app.test/a#x"]);
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
