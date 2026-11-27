// The bar's url, scroll and tab labels are hand-written in the module, so this table keeps them equal to the command line's (src/cmdline/status.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { status_widgets } from "../../src/cmdline/status.ts";
import { BAR_CONFIG, create_bar_fixture } from "./statusbar_window.ts";

const ADDRESSES = [
  "https://example.com/",
  "https://example.com/a/b?q=1#frag",
  "http://insecure.example.org/path",
  "about:preferences",
  "https://a-very-long-host-name.example.com/with/a/very/long/path/that/goes/on",
  "moz-extension://abc/page.html",
  "file:///home/user/doc.txt",
  "not a url",
];
const SCROLLS: [number, number][] = [
  [0, 0],
  [0, 500],
  [250, 500],
  [499, 500],
  [500, 500],
  [3, 1000],
  [995, 1000],
  [Number.NaN, 100],
];

function drawn(right: string[], setup: (fixture: ReturnType<typeof create_bar_fixture>) => void, tab_count = 1) {
  const fixture = create_bar_fixture({ tab_count });
  fixture.firefox.start_extension({ private_access: true });
  fixture.load();
  setup(fixture);
  fixture.firefox.write_state({ v: 1, enabled: true, keys: [], tabs: {}, bar: { ...BAR_CONFIG, right } });
  fixture.run_frames();
  return fixture;
}

test("the url label and its security color are the command line's", () => {
  for (const address of ADDRESSES) {
    const fixture = drawn(["url"], (each) => each.navigate(0, address));
    const [expected] = status_widgets(["url"], { url: address, tab_index: 0, tab_count: 1 }, undefined);
    assert.deepEqual(fixture.widgets("right"), [expected!.text], address);
    const node = fixture.bar()!.find((each) => each.className === "dfx-widget dfx-url")!;
    assert.equal(node.getAttribute("data-security"), expected!.state, address);
    assert.equal(node.getAttribute("title"), address);
  }
});

test("a page in Reader View shows the address of the page it holds", () => {
  const fixture = drawn(["url"], (each) => each.navigate(0, "about:reader?url=https%3A%2F%2Fexample.com%2Farticle"));
  assert.deepEqual(fixture.widgets("right"), ["example.com/article"]);
});

test("the scroll label is the command line's", () => {
  for (const [top, max] of SCROLLS) {
    const fixture = drawn(["scroll"], (each) => each.firefox.emit_message("desertfox-statusbar:scroll", each.tabs[0]!.browser, { inner: 10, top, max }));
    const [expected] = status_widgets(["scroll"], { url: "", tab_index: 0, tab_count: 1 }, { top, max });
    assert.deepEqual(fixture.widgets("right"), [expected!.text], `${top} of ${max}`);
  }
});

test("the tab place is the command line's", () => {
  for (const [index, count] of [[0, 1], [0, 3], [2, 3], [9, 12]] as const) {
    const fixture = drawn(["tabs"], (each) => each.select(index), count);
    const [expected] = status_widgets(["tabs"], { url: "", tab_index: index, tab_count: count }, undefined);
    assert.deepEqual(fixture.widgets("right"), [expected!.text], `${index} of ${count}`);
  }
});
