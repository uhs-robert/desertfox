// The hint lifecycle for rapid mode, text, copy and a custom selector, run on a fake page.
import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/commands/hint.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import type { Outcome } from "../../src/shared/messages.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { KEY_LINE_LABELS, KEY_LINE_TEXT } from "../../src/content/hints/view.ts";
import { is_editable_element } from "../../src/content/editable.ts";

class FakeNode {
  children: FakeNode[] = [];
  parent: FakeNode | undefined;
  style: Record<string, string> = {};
  className = "";
  textContent = "";
  shadow: FakeNode | undefined;
  append(...nodes: FakeNode[]) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  prepend(node: FakeNode) {
    node.parent = this;
    this.children.unshift(node);
  }
  replaceChildren(...nodes: FakeNode[]) {
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = undefined;
  }
  get childElementCount() {
    return this.children.length;
  }
  setAttribute() {}
  getAttribute() {
    return null;
  }
  querySelector() {
    return null;
  }
  // Only a class selector, over the children and the shadow tree.
  querySelectorAll(selector: string): FakeNode[] {
    const found: FakeNode[] = [];
    const walk = (node: FakeNode) => {
      if (node.className === selector.slice(1)) found.push(node);
      node.children.forEach(walk);
      if (node.shadow) walk(node.shadow);
    };
    this.children.forEach(walk);
    return found;
  }
  box: { left: number; top: number; right: number; bottom: number } | undefined;
  getBoundingClientRect() {
    return this.box ?? { left: 0, top: 0, right: 0, bottom: 0 };
  }
  before(node: FakeNode) {
    node.remove();
    node.parent = this.parent;
    this.parent!.children.splice(this.parent!.children.indexOf(this), 0, node);
  }
  matches(_selector: string) {
    return false;
  }
  showPopover() {}
  hidePopover() {}
  attachShadow() {
    this.shadow = new FakeNode();
    return this.shadow;
  }
}

type Link = FakeNode & { localName: string; href: string; rect_top: number; on_click: () => void; click: () => void; matches: (selector: string) => boolean };

// Reads a promise without waiting for it: undefined while it is still pending.
async function peek(answer: Outcome | Promise<Outcome>): Promise<Outcome | undefined> {
  return Promise.race([answer, new Promise<undefined>((resolve) => setTimeout(resolve, 20))]);
}

// A text pick waits this long, so the rest of the typed word is dropped (PICK_GRACE_MS in main.ts is 300).
const after_grace = () => new Promise((resolve) => setTimeout(resolve, 350));

const settle = async () => {
  for (let turn = 0; turn < 6; turn++) await new Promise((resolve) => setTimeout(resolve, 0));
};

class FakeHtmlElement {}
class FakeHtmlInputElement extends FakeHtmlElement {}

let import_count = 0;

// Builds a page of links with the given texts and loads the hints bundle against it.
async function page_with(texts: string[], settings: Record<string, unknown> = {}) {
  const document_root = new FakeNode();
  const links: Link[] = [];
  const active_listeners = new Set<string>();
  const sent: unknown[] = [];
  const timings: unknown[] = [];
  const repeat_records: unknown[] = [];
  const yanked: unknown[] = [];
  const copied: string[] = [];
  const modes: string[] = [];
  const held_key_batches: string[][] = [];
  let intersecting = true;
  const handlers = new Map<string, (args: Record<string, unknown>) => unknown>();
  let sink: { on_token_: (token: string) => string; exit: () => void } | undefined;
  let mode = "normal";
  let sends_held: (() => Promise<unknown>) | undefined;
  let holds = 0;
  // Keys and Escapes that arrived during a hold, in order.
  const held_input: (string | (() => void))[] = [];
  let hint_selectors: Record<string, unknown> | (() => Promise<unknown>) = {};
  let selector_asks = 0;
  const toasts: string[] = [];
  const set_mode = (next: string) => win.desertfox_host.set_mode_(next);
  const replay_held = () => {
    const replayed: string[] = [];
    for (const input of held_input.splice(0)) {
      if (typeof input === "function") input();
      else if (mode === "hint") sink!.on_token_(input);
      else replayed.push(input);
    }
    if (replayed.length > 0) held_key_batches.push(replayed);
  };
  // The text each `cmdline.open` was asked for. The line stays open until `close_line` answers it.
  const lines: string[] = [];
  let close_line: (outcome: Outcome) => void = () => {};

  const win = {
    innerWidth: 800,
    innerHeight: 600,
    getComputedStyle: () => ({ visibility: "visible" }),
    addEventListener: (type: string) => void active_listeners.add(type),
    removeEventListener: (type: string) => void active_listeners.delete(type),
    desertfox_host: {
      register_sink_: (_mode: string, registered: typeof sink) => void (sink = registered),
      register_handler_: (id: string, handler: (args: Record<string, unknown>) => unknown) => void handlers.set(id, handler),
      // The real host calls the sink's exit when the mode leaves hint.
      set_mode_: (next: string) => {
        modes.push(next);
        const left_hint = mode === "hint" && next !== "hint";
        mode = next;
        if (left_hint) sink?.exit();
      },
      get_mode: () => mode,
      is_editable_: is_editable_element,
      escape_: () => win.desertfox_host.set_mode_("normal"),
      // The caret bundle's `caret.mode` sets the caret mode it is asked for.
      run_command_: async (id: string, _name: string, args: Record<string, unknown>) => {
        if (id === "caret.mode") win.desertfox_host.set_mode_(args.mode as string);
        if (id === "cmdline.open") {
          lines.push(args.text as string);
          win.desertfox_host.set_mode_("cmdline");
          return new Promise<Outcome>((resolve) => (close_line = resolve));
        }
        return { ok: true };
      },
      show_toast_: (message: string) => void toasts.push(message),
      // As the real host: keys typed during a hold wait, and replay in the mode of the moment once no hold is left. An empty batch hands nothing back.
      hold_keys_until_: (handed_back: Promise<string[]>) => {
        holds++;
        void handed_back.then((tokens) => {
          holds--;
          if (tokens.length > 0) held_key_batches.push(tokens);
          if (holds === 0) replay_held();
        });
      },
    },
  };
  const doc = {
    documentElement: document_root,
    defaultView: win,
    createElement: () => new FakeNode(),
    addEventListener: () => {},
    elementFromPoint: () => null,
    querySelectorAll: () => [...links],
    // Only an unclosed bracket fails to parse here.
    createDocumentFragment: () => ({ querySelector: (selector: string) => { if (selector.includes("[") && !selector.includes("]")) throw new SyntaxError("bad selector"); } }),
  };
  const make_link = (text: string): Link => {
    const node = new FakeNode() as Link;
    Object.assign(node, {
      localName: "a",
      href: `https://example.com/${text.replaceAll(" ", "_")}`,
      textContent: text,
      rect_top: 10,
      ownerDocument: doc,
      on_click: () => {},
      click: () => node.on_click(),
      matches: (selector: string) => {
        if (selector === "a[") throw new SyntaxError("bad selector");
        return true;
      },
      getBoundingClientRect: () => ({ left: 0, top: node.rect_top, right: 50, bottom: node.rect_top + 10 }),
      getClientRects: () => [{ left: 0, top: node.rect_top, right: 50, bottom: node.rect_top + 10 }],
      remove: () => void links.splice(links.indexOf(node), 1),
      focus: () => {},
      // Each link is inside a `.text-<its text>` box, for `hint_remove`.
      closest: (selector: string) => (selector.split(", ").includes(`.text-${text}`) ? node : null),
    });
    return node;
  };
  links.push(...texts.map(make_link));
  const globals = globalThis as Record<string, unknown>;
  globals.window = win;
  globals.document = doc;
  // The one-match path asks whether a field has focus, which tests `instanceof HTMLElement` and `HTMLInputElement`.
  globals.HTMLElement = FakeHtmlElement;
  globals.HTMLInputElement = FakeHtmlInputElement;
  globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);
  globals.IntersectionObserver = class {
    callback: (entries: unknown[]) => void;
    constructor(callback: (entries: unknown[]) => void) {
      this.callback = callback;
    }
    targets: unknown[] = [];
    // One callback with every target, as the browser delivers the first observation.
    observe = (target: unknown) => {
      if (this.targets.push(target) === 1) queueMicrotask(() => this.callback(this.targets.map((each) => ({ isIntersecting: intersecting, target: each }))));
    };
    disconnect = () => {};
  };
  globals.browser = { storage: { local: { get: async () => ({ desertfox_config_status: { settings } }) }, onChanged: { addListener: () => {} } }, runtime: { sendMessage: async (message: unknown) => {
    if ((message as { type?: string }).type === "register_yank") return void yanked.push(message), { ok: true };
    if ((message as { type?: string }).type === "record_timing") return void timings.push(message);
    if ((message as { type?: string }).type === "read_hint_selectors") return selector_asks++, typeof hint_selectors === "function" ? hint_selectors() : hint_selectors;
    const is_record = (message as { type?: string }).type === "record_step";
    (is_record ? repeat_records : sent).push(message);
    return is_record ? undefined : sends_held?.();
  } } };
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (text: string) => void copied.push(text) } }, configurable: true });
  await import(`${new URL("../../src/content/hints/main.ts", import.meta.url).href}?extras${import_count++}`);

  const nodes_with_class = (name: string): FakeNode[] => {
    const found: FakeNode[] = [];
    const walk = (node: FakeNode) => {
      if (node.className === name) found.push(node);
      node.children.forEach(walk);
      if (node.shadow) walk(node.shadow);
    };
    walk(document_root);
    return found;
  };
  return {
    links,
    sent,
    timings,
    repeat_records,
    yanked,
    copied,
    modes,
    // Each batch of keys that hint mode handed back to the keymap, in order.
    held_key_batches,
    lines,
    close_line: (outcome: Outcome = { ok: true }) => close_line(outcome),
    // The next build finds no candidate in view.
    hide_all: () => void (intersecting = false),
    // The next opened link answers when this promise settles.
    refuse_clipboard: () => Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: () => Promise.reject(new Error("denied")) } }, configurable: true }),
    hold_sends: (held: () => Promise<unknown>) => void (sends_held = held),
    mode: () => mode,
    active_listeners,
    // What the handler answers: an Outcome now, or a promise that stays pending while hints wait for the user.
    run: (args: Record<string, unknown>) => handlers.get("hint.run")!({ action: "here", filter: "links", rapid: false, ...args }) as Outcome | Promise<Outcome>,
    type: (token: string) => (holds > 0 ? (held_input.push(token), "handled") : sink!.on_token_(token)),
    escape: () => (holds > 0 ? void held_input.push(() => set_mode("normal")) : set_mode("normal")),
    // What the background answers to `read_hint_selectors`.
    // An object answers at once. A function gives the answer as a promise, so a test can reject it or leave it pending.
    set_hint_selectors: (selectors: Record<string, unknown> | (() => Promise<unknown>)) => void (hint_selectors = selectors),
    selector_asks: () => selector_asks,
    toasts,
    // The focus event of a field that takes focus.
    enter_insert: () => win.desertfox_host.set_mode_("insert"),
    // The label text of each label that is not hidden by typing.
    labels: () => nodes_with_class("desertfox-hint").filter((node) => node.style.display !== "none").map((node) => node.children.map((part) => part.textContent).join("")),
    label_tops: () => nodes_with_class("desertfox-hint").map((node) => node.style.top),
    nodes_with_class,
    labels_of: (node: FakeNode) => node.children.map((part) => part.textContent).join(""),
    messages: () => nodes_with_class("desertfox-hint-message").map((node) => node.textContent),
    // The backdrop reset style is a child too; only a surface host has a shadow root.
    host_count: () => document_root.children.filter((child) => child.shadow).length,
    caret_target: () => win as unknown as { desertfox_caret_target?: unknown },
  };
}

test("rapid: each pick opens its link, keeps hint mode and labels the page again", async () => {
  const page = await page_with(["one", "two", "three"]);
  page.run({ action: "background", rapid: true });
  await settle();
  assert.equal(page.labels().length, 3);
  assert.equal(page.type(page.labels()[0]!.toLowerCase()), "handled");
  await settle();
  assert.equal(page.sent.length, 1);
  assert.equal(page.mode(), "hint");
  assert.equal(page.labels().length, 3);
  assert.equal(page.host_count(), 1);
  page.type(page.labels()[2]!.toLowerCase());
  await settle();
  assert.equal(page.sent.length, 2);
  assert.deepEqual([...page.active_listeners].sort(), ["resize", "scroll"]);
  page.escape();
});

test("rapid delete: the deleted element loses its label and the last pick ends hint mode", async () => {
  const page = await page_with(["one", "two"]);
  page.run({ action: "delete", rapid: true });
  await settle();
  page.type(page.labels()[0]!.toLowerCase());
  await settle();
  assert.equal(page.links.length, 1);
  assert.equal(page.labels().length, 1);
  assert.equal(page.mode(), "hint");
  page.type(page.labels()[0]!.toLowerCase());
  await settle();
  assert.equal(page.links.length, 0);
  assert.equal(page.mode(), "normal");
  assert.equal(page.labels().length, 0);
  assert.deepEqual(page.messages(), ["No hints on this page"]);
  assert.equal(page.active_listeners.size, 0);
});

test("rapid here: a click that removes or moves an element is followed by fresh labels", async () => {
  const page = await page_with(["one", "two", "three"]);
  const [removing, moving] = page.links as [Link, Link, Link];
  removing.on_click = () => removing.remove();
  moving.on_click = () => {
    moving.rect_top = 300;
  };
  page.run({ action: "here", rapid: true });
  await settle();
  page.type(page.labels()[0]!.toLowerCase());
  await settle();
  assert.equal(page.labels().length, 2);
  const label_tops = () => page.links.map((link) => link.rect_top);
  page.type(page.labels()[0]!.toLowerCase());
  await settle();
  assert.deepEqual(label_tops(), [300, 10]);
  assert.equal(page.links.includes(removing), false);
  assert.deepEqual(page.label_tops(), ["300px", "10px"]);
  assert.equal(page.labels().length, 2);
  assert.equal(page.mode(), "hint");
  page.escape();
});

test("Escape ends rapid mode: no labels, no listeners, keys pass again", async () => {
  const page = await page_with(["one", "two"]);
  page.run({ action: "background", rapid: true });
  await settle();
  page.type(page.labels()[0]!.toLowerCase());
  await settle();
  page.escape();
  assert.equal(page.labels().length, 0);
  assert.equal(page.host_count(), 0);
  assert.equal(page.active_listeners.size, 0);
  assert.equal(page.type("a"), "pass");
});

test("Escape while a rapid rebuild is pending leaves no labels or listeners behind", async () => {
  const page = await page_with(["one", "two"]);
  page.run({ action: "background", rapid: true });
  await settle();
  page.type(page.labels()[0]!.toLowerCase());
  page.escape();
  await settle();
  assert.equal(page.labels().length, 0);
  assert.equal(page.host_count(), 0);
  assert.equal(page.active_listeners.size, 0);
  assert.equal(page.mode(), "normal");
});

test("text keeps links whose text holds it, ignoring case", async () => {
  const page = await page_with(["Alpha one", "Beta", "alpha two"]);
  page.run({ text: "ALPHA" });
  await settle();
  assert.equal(page.labels().length, 2);
  assert.equal(page.mode(), "hint");
  page.escape();
});

test("text with no match shows a notice and stays in normal mode", async () => {
  const page = await page_with(["Alpha", "Beta"]);
  const outcome = page.run({ text: "zzz" });
  await settle();
  assert.deepEqual(await outcome, { ok: false, message: "No link matches zzz" });
  assert.deepEqual(page.messages(), []);
  assert.equal(page.mode(), "normal");
  assert.equal(page.active_listeners.size, 0);
});

test("text with one match runs it at once, also in rapid mode, and ends hint mode", async () => {
  for (const rapid of [false, true]) {
    const page = await page_with(["Alpha", "Beta"]);
    page.run({ text: "bet", action: "background", rapid });
    await settle();
    assert.equal(page.sent.length, 1);
    assert.equal(page.mode(), "normal");
    assert.equal(page.labels().length, 0);
    assert.equal(page.active_listeners.size, 0);
    assert.equal(page.type("a"), "pass");
  }
});

test("rapid with text keeps filtering after each pick", async () => {
  const page = await page_with(["Alpha one", "Alpha two", "Beta"]);
  page.run({ text: "alpha", action: "delete", rapid: true });
  await settle();
  page.type(page.labels()[0]!.toLowerCase());
  await settle();
  assert.equal(page.links.length, 2);
  assert.equal(page.labels().length, 1);
  page.escape();
});

test("/ then text narrows the labels, and one match picks at once", async () => {
  const page = await page_with(["Alpha one", "Alpha two", "Beta"]);
  page.run({ action: "delete" });
  await settle();
  assert.equal(page.type("/"), "handled");
  assert.equal(page.labels().length, 3);
  assert.equal(page.nodes_with_class("desertfox-hint-text").length, 1);
  assert.equal(page.type("e"), "handled");
  assert.equal(page.links.length, 3);
  assert.equal(page.type("t"), "handled");
  await after_grace();
  await settle();
  assert.deepEqual(page.links.map((link) => link.textContent), ["Alpha one", "Alpha two"]);
  assert.equal(page.mode(), "normal");
});

test("the rest of a word typed after the key that made one match is dropped, and the pick runs after the grace", async () => {
  const page = await page_with(["Alpha one", "Alpha two", "Beta"]);
  page.run({ action: "delete" });
  await settle();
  page.type("/");
  page.type("b");
  for (const key of ["e", "j", "<Space>", "<Tab>"]) assert.equal(page.type(key), "handled", key);
  assert.equal(page.links.length, 3);
  assert.equal(page.mode(), "hint");
  await after_grace();
  await settle();
  assert.deepEqual(page.links.map((link) => link.textContent), ["Alpha one", "Alpha two"]);
  assert.equal(page.mode(), "normal");
  assert.deepEqual(page.held_key_batches, []);
});

test("in rapid mode the rest of the word never types a label in the next round", async () => {
  const page = await page_with(["Alpha one", "Alpha two", "Beta"]);
  page.run({ action: "delete", rapid: true });
  await settle();
  page.type("/");
  page.type("b");
  page.type("a");
  page.type("s");
  await after_grace();
  await settle();
  assert.equal(page.links.length, 2);
  assert.equal(page.labels().length, 2);
  page.escape();
});

test("Escape during the grace cancels the pick", async () => {
  const page = await page_with(["Alpha one", "Beta"]);
  page.run({ action: "delete" });
  await settle();
  page.type("/");
  page.type("b");
  page.escape();
  await after_grace();
  assert.equal(page.links.length, 2);
});

test("Space turns the stacking order of labels that overlap, reading the boxes again on each press", async () => {
  const page = await page_with(["one", "two", "three"]);
  page.run({ action: "delete" });
  await settle();
  const [first, second, third] = page.nodes_with_class("desertfox-hint");
  const order = () => page.nodes_with_class("desertfox-hint").map((node) => page.labels_of(node));
  const overlap = { left: 0, top: 0, right: 20, bottom: 10 };
  first!.box = overlap;
  second!.box = { ...overlap, left: 10 };
  third!.box = { left: 100, top: 100, right: 120, bottom: 110 };
  const before = order();
  page.type("<Space>");
  assert.deepEqual(order(), [before[1], before[0], before[2]]);
  page.type("<Space>");
  assert.deepEqual(order(), before);
  // A scroll moved the third label onto the others, so all three turn together now.
  third!.box = { ...overlap, left: 5 };
  page.type("<Space>");
  assert.deepEqual(order(), [before[2], before[0], before[1]]);
  // A label hidden by typing is not part of a group.
  first!.style.display = "none";
  page.type("<Space>");
  assert.deepEqual(order(), [before[1], before[2], before[0]]);
  page.escape();
});

test("text mode swaps the colors of the active hint and shows the typed text, and label mode takes both away", async () => {
  const page = await page_with(["Alpha one", "Alpha two", "Beta"]);
  page.run({ action: "delete" });
  await settle();
  const active_nodes = () => page.nodes_with_class("desertfox-hint").filter((node) => node.style.background === "var(--label-text)");
  assert.equal(active_nodes().length, 0);
  page.type("/");
  page.type("a");
  assert.equal(active_nodes().length, 1);
  assert.equal(page.nodes_with_class("desertfox-hint-text")[0]!.textContent, "text: a");
  page.type("<Tab>");
  assert.equal(active_nodes().length, 1);
  assert.equal(active_nodes()[0]!.style.color, "var(--primary)");
  page.type("<Backspace>");
  page.type("<Backspace>");
  assert.equal(active_nodes().length, 0);
  assert.equal(page.nodes_with_class("desertfox-hint-text").length, 0);
  page.escape();
});

test("the key line shows in label mode, switches its words in text mode and goes with the labels", async () => {
  const page = await page_with(["Alpha one", "Beta"]);
  page.run({ action: "delete" });
  await settle();
  const line = () => page.nodes_with_class("desertfox-hint-keys").map((node) => node.textContent);
  assert.deepEqual(line(), [KEY_LINE_LABELS]);
  // First in the container, so the labels paint over it.
  const [key_line] = page.nodes_with_class("desertfox-hint-keys");
  assert.equal(key_line!.parent!.children[0], key_line);
  page.type("/");
  assert.deepEqual(line(), [KEY_LINE_TEXT]);
  page.type("<Backspace>");
  assert.deepEqual(line(), [KEY_LINE_LABELS]);
  page.escape();
  assert.deepEqual(line(), []);
});

test("hint_key_line off draws no key line", async () => {
  const page = await page_with(["Alpha one", "Beta"], { hint_key_line: false });
  page.run({ action: "delete" });
  await settle();
  assert.equal(page.nodes_with_class("desertfox-hint-keys").length, 0);
  assert.equal(page.labels().length, 2);
  page.escape();
});

test("Space and Enter typed while the hints are found wait and replay in order", async () => {
  const page = await page_with(["Alpha one", "Alpha two", "Beta"]);
  page.run({ action: "delete" });
  for (const key of ["/", "a", "l", "<Space>", "t", "<Enter>"]) assert.equal(page.type(key), "handled", key);
  await settle();
  // "al t" matches both Alpha links ("t" is in "two" only), so "Alpha two" is the one match and picks at once, ahead of the Enter.
  await after_grace();
  await settle();
  assert.deepEqual(page.links.map((link) => link.textContent), ["Alpha one", "Beta"]);
});

test("Tab and Shift-Tab move the active hint and Enter picks it", async () => {
  const page = await page_with(["Alpha one", "Alpha two", "Beta"]);
  page.run({ action: "delete" });
  await settle();
  for (const key of ["/", "a", "l", "p", "<Tab>", "<Tab>", "<S-Tab>", "<Enter>"]) page.type(key);
  await settle();
  assert.deepEqual(page.links.map((link) => link.textContent), ["Alpha one", "Beta"]);
});

test("Backspace on empty text goes back to label mode with the labels typable", async () => {
  const page = await page_with(["Alpha one", "Alpha two", "Beta"]);
  page.run({ action: "delete" });
  await settle();
  page.type("/");
  page.type("a");
  page.type("l");
  page.type("<Backspace>");
  page.type("<Backspace>");
  assert.equal(page.type("<Backspace>"), "handled");
  assert.equal(page.nodes_with_class("desertfox-hint-text").length, 0);
  assert.equal(page.labels().length, 3);
  assert.equal(page.links.length, 3);
  page.type(page.labels()[1]!.toLowerCase());
  await settle();
  assert.deepEqual(page.links.map((link) => link.textContent), ["Alpha one", "Beta"]);
});

test("a rapid rebuild after a text pick is back in label mode", async () => {
  const page = await page_with(["Alpha one", "Alpha two", "Beta"]);
  page.run({ action: "delete", rapid: true });
  await settle();
  for (const key of ["/", "b", "e", "t"]) page.type(key);
  await after_grace();
  await settle();
  assert.equal(page.links.length, 2);
  assert.equal(page.nodes_with_class("desertfox-hint-text").length, 0);
  assert.equal(page.labels().length, 2);
  assert.deepEqual(page.nodes_with_class("desertfox-hint-keys").map((node) => node.textContent), [KEY_LINE_LABELS]);
  page.type(page.labels()[0]!.toLowerCase());
  await settle();
  assert.equal(page.links.length, 1);
  page.escape();
});

test("/ and text typed while the hints are found wait, then switch and filter", async () => {
  const page = await page_with(["Alpha one", "Alpha two", "Beta"]);
  page.run({ action: "delete" });
  for (const key of ["/", "b", "e", "t"]) assert.equal(page.type(key), "handled");
  await after_grace();
  await settle();
  assert.deepEqual(page.links.map((link) => link.textContent), ["Alpha one", "Alpha two"]);
});

test("Space in label mode keeps the labels and does not pick", async () => {
  const page = await page_with(["Alpha one", "Alpha two"]);
  page.run({ action: "delete" });
  await settle();
  assert.equal(page.type("<Space>"), "handled");
  assert.equal(page.labels().length, 2);
  assert.equal(page.links.length, 2);
  page.escape();
});

test("copy writes the address and copy_text writes the text, rapid keeps the labels", async () => {
  const page = await page_with(["one", "two"]);
  page.run({ action: "copy" });
  await settle();
  page.type(page.labels()[0]!.toLowerCase());
  await settle();
  assert.deepEqual(page.copied, ["https://example.com/one"]);
  assert.equal(page.mode(), "normal");
  const rapid_page = await page_with(["one", "two"]);
  rapid_page.run({ action: "copy_text", rapid: true });
  await settle();
  rapid_page.type(rapid_page.labels()[1]!.toLowerCase());
  await settle();
  assert.deepEqual(rapid_page.copied, ["two"]);
  assert.equal(rapid_page.labels().length, 2);
  assert.match(rapid_page.messages()[0]!, /^Copied 1 text$/);
  rapid_page.escape();
});

test("an invalid custom selector shows a notice instead of throwing", async () => {
  const page = await page_with(["one"]);
  assert.deepEqual(await page.run({ filter: "custom", selector: "a[" }), { ok: false, message: "Invalid selector: a[" });
  assert.deepEqual(page.messages(), []);
  assert.deepEqual(page.modes, []);
});

test("hint.run needs no text: it defaults to empty, which filters nothing", () => {
  const checked = check_args(registry.get("hint.run")!, { action: "here" });
  assert.deepEqual(checked, { ok: true, args: { action: "here", filter: "clickable", text: "", rapid: false, register: "" } });
  assert.equal(check_args(registry.get("hint.run")!, { action: "copy_text", text: "x", rapid: true }).ok, true);
});

test("text keeps links only: a sole matching button is not clicked", async () => {
  const page = await page_with(["Alpha", "Beta"]);
  let clicks = 0;
  const button = page.links[1]!;
  Object.assign(button, { localName: "button", href: undefined, on_click: () => void clicks++ });
  const outcome = page.run({ text: "beta", filter: "clickable" });
  await settle();
  assert.equal(clicks, 0);
  assert.deepEqual(await outcome, { ok: false, message: "No link matches beta" });
  assert.equal(page.mode(), "normal");
});

test("text with no candidate at all shows the no-link notice", async () => {
  const page = await page_with([]);
  assert.deepEqual(await page.run({ text: "zzz" }), { ok: false, message: "No link matches zzz" });
  assert.deepEqual(page.modes, []);
});

test("keys typed while rapid mode builds again wait and replay, also when the first one picks", async () => {
  const page = await page_with(["one", "two"]);
  page.run({ action: "background", rapid: true });
  // Both keys arrive before the first build ends: the first pick starts the next build, and the second key replays there.
  assert.equal(page.type("a"), "handled");
  assert.equal(page.type("s"), "handled");
  await settle();
  assert.equal(page.sent.length, 2);
  assert.equal(page.mode(), "hint");
  assert.equal(page.labels().length, 2);
  // A key typed during a rebuild after a pick waits too.
  page.type("a");
  assert.equal(page.type("s"), "handled");
  await settle();
  assert.equal(page.sent.length, 4);
  page.escape();
});

test("keys typed behind a non-rapid label pick reach normal mode", async () => {
  const page = await page_with(["one", "two"]);
  page.run({ action: "background" });
  page.type("a");
  page.type("j");
  await settle();
  assert.equal(page.sent.length, 1);
  assert.equal(page.mode(), "normal");
  assert.deepEqual(page.held_key_batches, [["j"]]);
});

test("Escape during the build drops the queued keys", async () => {
  const page = await page_with(["one", "two"]);
  page.run({ action: "background" });
  page.type("j");
  page.escape();
  await settle();
  assert.equal(page.sent.length, 0);
  assert.deepEqual(page.held_key_batches, []);
});

// A click that focuses a textarea, as a "Search" link does. `inserted` is what `execCommand("insertText")` received.
async function page_whose_link_focuses_a_field(focuses_field: boolean, field_focused_before = false) {
  const page = await page_with(["Search"]);
  const doc = document as unknown as { activeElement?: unknown; execCommand?: unknown };
  const textarea = Object.assign(new FakeHtmlElement(), { tagName: "TEXTAREA", isContentEditable: false });
  const inserted: string[] = [];
  doc.activeElement = field_focused_before ? textarea : null;
  doc.execCommand = (command: string, _ui: boolean, text: string) => command === "insertText" && inserted.push(text) > 0;
  page.links[0]!.on_click = () => {
    if (!focuses_field) return;
    doc.activeElement = textarea;
    page.enter_insert();
  };
  return { page, inserted };
}

test("a text pick that focuses a field types the keys queued during the build into it", async () => {
  const { page, inserted } = await page_whose_link_focuses_a_field(true);
  page.run({ text: "sear" });
  page.type("a");
  page.type("b");
  await settle();
  assert.deepEqual(inserted, ["a", "b"]);
  assert.deepEqual(page.held_key_batches, []);
});

test("a label pick that focuses a field types the keys queued behind it into it", async () => {
  const { page, inserted } = await page_whose_link_focuses_a_field(true);
  page.run({ action: "here" });
  page.type("a");
  page.type("b");
  await settle();
  assert.deepEqual(inserted, ["b"]);
  assert.deepEqual(page.held_key_batches, []);
});

test("a text pick that focuses no field hands the queued keys back to the keymap", async () => {
  const { page, inserted } = await page_whose_link_focuses_a_field(false);
  page.run({ text: "sear" });
  page.type("a");
  page.type("b");
  await settle();
  assert.deepEqual(inserted, []);
  assert.deepEqual(page.held_key_batches, [["a", "b"]]);
});

test("a text pick that leaves an earlier focused field alone hands the keys back instead of typing into it", async () => {
  const { page, inserted } = await page_whose_link_focuses_a_field(false, true);
  page.run({ text: "sear" });
  page.type("a");
  page.type("b");
  await settle();
  assert.deepEqual(inserted, []);
  assert.deepEqual(page.held_key_batches, [["a", "b"]]);
});

test("caret and visual hand the picked element to the caret bundle and enter that mode, also with rapid", async () => {
  for (const action of ["caret", "visual"]) {
    const page = await page_with(["one", "two"]);
    page.run({ action, rapid: true });
    await settle();
    page.type(page.labels()[1]!.toLowerCase());
    await settle();
    assert.equal(page.caret_target().desertfox_caret_target, page.links[1]);
    assert.equal(page.mode(), action);
    assert.equal(page.labels().length, 0);
  }
});

test("caret with one text match starts at once at that link", async () => {
  const page = await page_with(["one", "two"]);
  page.run({ action: "caret", text: "two" });
  await settle();
  assert.equal(page.caret_target().desertfox_caret_target, page.links[1]);
  assert.equal(page.mode(), "caret");
});

test("a hint pick tells the background what `.` shows again and a macro keeps, and a pick that opens a link is marked from_hints", async () => {
  const page = await page_with(["one", "two"]);
  const args = { action: "tab", filter: "links", text: "", rapid: true };
  page.run(args);
  await settle();
  page.type(page.labels()[0]!.toLowerCase());
  await settle();
  const record = { type: "record_step", invocations: [{ id: "hint.run", args }], outcome: { ok: true }, pick: true };
  assert.deepEqual(page.repeat_records, [record]);
  assert.equal((page.sent.at(-1) as { from_hints?: boolean }).from_hints, true);
});

test("hint.run waits until a label is picked, then answers done and the mode change that follows does not cancel it", async () => {
  const page = await page_with(["one", "two"]);
  const answer = page.run({ action: "background" });
  await settle();
  assert.equal(await peek(answer), undefined);
  page.type(page.labels()[0]!.toLowerCase());
  assert.deepEqual(await answer, { ok: true });
  assert.equal(page.mode(), "normal");
});

test("the first build and a rapid rebuild each report a hint.build time", async () => {
  const page = await page_with(["one", "two"]);
  void page.run({ action: "background", rapid: true });
  await settle();
  assert.equal(page.timings.length, 1);
  const [timing] = page.timings as { type: string; name: string; ms: number }[];
  assert.deepEqual([timing!.type, timing!.name, timing!.ms >= 0], ["record_timing", "hint.build", true]);
  page.type(page.labels()[0]!.toLowerCase());
  await settle();
  assert.equal(page.timings.length, 2);
});

test("hint.run answers cancelled when the mode ends with no pick, and a later exit changes nothing", async () => {
  const page = await page_with(["one", "two"]);
  const answer = page.run({ action: "background" });
  await settle();
  page.escape();
  assert.deepEqual(await answer, { ok: true, cancelled: true });
  assert.equal(page.sent.length, 0);
  page.escape();
  assert.deepEqual(await answer, { ok: true, cancelled: true });
});

test("hint.run answers cancelled while the labels are still being found", async () => {
  const page = await page_with(["one", "two"]);
  const answer = page.run({ action: "background" });
  page.escape();
  assert.deepEqual(await answer, { ok: true, cancelled: true });
});

test("a new hint.run cancels the one before it", async () => {
  const page = await page_with(["one", "two"]);
  const first = page.run({ action: "background" });
  await settle();
  const second = page.run({ action: "background" });
  assert.deepEqual(await first, { ok: true, cancelled: true });
  await settle();
  assert.equal(await peek(second), undefined);
  page.escape();
});

test("a one-match text run answers done without labels", async () => {
  const page = await page_with(["Alpha", "Beta"]);
  const answer = page.run({ text: "bet", action: "background" });
  await settle();
  assert.deepEqual(await answer, { ok: true });
});

test("rapid mode answers done at the first pick and Escape later changes nothing", async () => {
  const page = await page_with(["one", "two"]);
  const answer = page.run({ action: "background", rapid: true });
  await settle();
  page.type(page.labels()[0]!.toLowerCase());
  await settle();
  assert.deepEqual(await answer, { ok: true });
  page.escape();
  assert.deepEqual(await answer, { ok: true });
});

test("Escape or zero candidates stores nothing for `.`, and a pick stores it", async () => {
  const page = await page_with(["one", "two"]);
  const answer = page.run({ action: "background" });
  await settle();
  page.escape();
  await answer;
  assert.deepEqual(page.repeat_records, []);
  const none = await page_with([]);
  none.run({ action: "background" });
  assert.deepEqual(none.repeat_records, []);
  const picked = await page_with(["one", "two"]);
  picked.run({ action: "background" });
  await settle();
  picked.type(picked.labels()[0]!.toLowerCase());
  await settle();
  assert.equal(picked.repeat_records.length, 1);
});

test("hint.run answers done only after the picked link has been opened", async () => {
  const page = await page_with(["one", "two"]);
  let opened!: (value: unknown) => void;
  const held = new Promise((resolve) => (opened = resolve));
  page.hold_sends(() => held);
  const answer = page.run({ action: "background" });
  await settle();
  page.type(page.labels()[0]!.toLowerCase());
  assert.equal(await peek(answer), undefined);
  opened({ ok: true });
  assert.deepEqual(await answer, { ok: true });
});

test("a hint copy leaves the text in the unnamed register, and in the named one a register arg names", async () => {
  const page = await page_with(["one", "two"]);
  const plain = page.run({ action: "copy" });
  await settle();
  page.type(page.labels()[0]!.toLowerCase());
  await plain;
  const named = await page_with(["one", "two"]);
  const answer = named.run({ action: "copy_text", register: "b" });
  await settle();
  named.type(named.labels()[1]!.toLowerCase());
  assert.deepEqual(await answer, { ok: true });
  assert.deepEqual(page.yanked, [{ type: "register_yank", name: "", text: "https://example.com/one" }]);
  assert.deepEqual(named.yanked, [{ type: "register_yank", name: "b", text: "two" }]);
});

test("a hint copy into the black hole copies nothing and shows no message", async () => {
  const page = await page_with(["one", "two"]);
  const answer = page.run({ action: "copy", register: "_" });
  await settle();
  page.type(page.labels()[0]!.toLowerCase());
  assert.deepEqual(await answer, { ok: true });
  assert.deepEqual([page.copied, page.yanked, page.messages()], [[], [], []]);
});

test("a refused hint copy answers failed with one message, and a good copy answers done", async () => {
  const page = await page_with(["one", "two"]);
  page.refuse_clipboard();
  const answer = page.run({ action: "copy" });
  await settle();
  page.type(page.labels()[0]!.toLowerCase());
  await settle();
  assert.deepEqual(await answer, { ok: false, message: "Could not copy to the clipboard" });
  assert.deepEqual(page.messages(), []);

  const good = await page_with(["one", "two"]);
  const done = good.run({ action: "copy" });
  await settle();
  good.type(good.labels()[0]!.toLowerCase());
  assert.deepEqual(await done, { ok: true });
  assert.deepEqual(good.copied, ["https://example.com/one"]);
});

test("a refused open stops the sequence quietly, and a later rapid pick whose open is refused shows nothing", async () => {
  const page = await page_with(["one", "two"]);
  page.hold_sends(async () => ({ ok: false, refusal: { id: "open.url", message: "No such tab" } }));
  const answer = page.run({ action: "background", rapid: true });
  await settle();
  page.type(page.labels()[0]!.toLowerCase());
  await settle();
  assert.deepEqual(await answer, { ok: true, cancelled: true });
  page.type(page.labels()[0]!.toLowerCase());
  await settle();
  assert.deepEqual(page.messages(), []);
  page.escape();
});

test("a pick whose action throws answers failed, and one whose open reply is lost answers cancelled", async () => {
  const thrown = await page_with(["one", "two"]);
  thrown.links[0]!.on_click = () => {
    throw new Error("can't access dead object");
  };
  const failed = thrown.run({ action: "here" });
  await settle();
  thrown.type(thrown.labels()[0]!.toLowerCase());
  assert.deepEqual(await failed, { ok: false, message: "can't access dead object" });

  const lost = await page_with(["one", "two"]);
  lost.hold_sends(() => Promise.reject(new Error("The message channel closed")));
  const cancelled = lost.run({ action: "background" });
  await settle();
  lost.type(lost.labels()[0]!.toLowerCase());
  assert.deepEqual(await cancelled, { ok: true, cancelled: true });
});

test("rapid delete: a key typed in the last rebuild gap runs in normal mode", async () => {
  const page = await page_with(["one", "two"]);
  page.run({ action: "delete", rapid: true });
  await settle();
  page.type(page.labels()[0]!.toLowerCase());
  await settle();
  page.type(page.labels()[0]!.toLowerCase());
  assert.equal(page.type("j"), "handled");
  await settle();
  assert.equal(page.mode(), "normal");
  assert.deepEqual(page.held_key_batches, [["j"]]);
});

test("a first build with nothing in view hands the keys typed meanwhile back", async () => {
  const page = await page_with(["one", "two"]);
  page.hide_all();
  const outcome = page.run({});
  assert.equal(page.type("j"), "handled");
  await settle();
  assert.deepEqual(await outcome, { ok: false, message: "No hints on this page" });
  assert.equal(page.mode(), "normal");
  assert.deepEqual(page.held_key_batches, [["j"]]);
});

test("text with one match hands the keys typed meanwhile back", async () => {
  const page = await page_with(["Alpha", "Beta"]);
  page.run({ text: "bet", action: "background" });
  assert.equal(page.type("j"), "handled");
  await settle();
  assert.equal(page.sent.length, 1);
  assert.equal(page.mode(), "normal");
  assert.deepEqual(page.held_key_batches, [["j"]]);
});

test("keys handed back keep the order they were typed in", async () => {
  const page = await page_with(["one"]);
  page.hide_all();
  page.run({});
  for (const key of ["j", "k", "a", "j"]) page.type(key);
  await settle();
  assert.deepEqual(page.held_key_batches, [["j", "k", "a", "j"]]);
});

test("no keys typed during a failed build hand nothing back", async () => {
  const page = await page_with(["one"]);
  page.hide_all();
  page.run({});
  await settle();
  assert.deepEqual(page.held_key_batches, []);
});

test("prompt opens the line with the command and the address, and stays pending until the line closes", async () => {
  const page = await page_with(["one", "two"]);
  const answer = page.run({ action: "prompt", command: "open" });
  await settle();
  page.type(page.labels()[1]!.toLowerCase());
  await settle();
  assert.deepEqual(page.lines, ["open https://example.com/two"]);
  assert.equal(page.mode(), "cmdline");
  assert.equal(await peek(answer), undefined);
  page.close_line();
  assert.deepEqual(await answer, { ok: true });
});

test("prompt takes the command the binding names and quotes an address the line would split", async () => {
  const page = await page_with(["a b", "it's", "plain"]);
  page.links[0]!.href = "https://example.com/a b";
  page.links[1]!.href = "https://example.com/it's";
  page.run({ action: "prompt", command: "open --tab" });
  await settle();
  page.type(page.labels()[0]!.toLowerCase());
  await settle();
  assert.deepEqual(page.lines, ["open --tab 'https://example.com/a b'"]);
  page.close_line();
  const second = await page_with(["it's"]);
  second.links[0]!.href = "https://example.com/it's";
  second.run({ action: "prompt", command: "open", text: "it" });
  await settle();
  assert.deepEqual(second.lines, ["open 'https://example.com/it'\\''s'"]);
});

test("prompt on an element with no address refuses and opens no line", async () => {
  const page = await page_with(["one"]);
  page.links[0]!.href = undefined as never;
  const answer = page.run({ action: "prompt", command: "open", filter: "all" });
  await settle();
  page.type(page.labels()[0]!.toLowerCase());
  assert.deepEqual(await answer, { ok: false, message: "This element has no web address" });
  assert.deepEqual(page.lines, []);
});

test("prompt ignores rapid: one pick ends hint mode", async () => {
  const page = await page_with(["one", "two"]);
  page.run({ action: "prompt", command: "open", rapid: true });
  await settle();
  page.type(page.labels()[0]!.toLowerCase());
  await settle();
  assert.equal(page.lines.length, 1);
  assert.equal(page.labels().length, 0);
  assert.equal(page.mode(), "cmdline");
});

test("a key typed while the labels were built is held until the line is up, never run in normal mode", async () => {
  const page = await page_with(["one", "two"]);
  page.run({ action: "prompt", command: "open", text: "two" });
  assert.equal(page.type("x"), "handled");
  await settle();
  assert.deepEqual(page.modes, ["hint", "normal", "cmdline"]);
  assert.deepEqual(page.lines, ["open https://example.com/two"]);
  assert.deepEqual(page.held_key_batches, [["x"]]);
});

test("rapid copy collects the picks into one list without a repeat and rewrites the register each time", async () => {
  const page = await page_with(["one", "two", "three"]);
  page.run({ action: "copy", rapid: true, register: "a" });
  await settle();
  const pick = async (index: number) => {
    page.type(page.labels()[index]!.toLowerCase());
    await settle();
  };
  await pick(0);
  await pick(2);
  await pick(0);
  assert.deepEqual(page.copied, ["https://example.com/one", "https://example.com/one\nhttps://example.com/three", "https://example.com/one\nhttps://example.com/three"]);
  assert.equal(page.yanked.length, 3);
  assert.deepEqual(page.messages().slice(0, 2), ["Copied 1 address", "Copied 2 addresses"]);
  page.escape();
});

test("rapid copy_text collects the texts and a repeat adds nothing", async () => {
  const page = await page_with(["one", "two"]);
  page.run({ action: "copy_text", rapid: true });
  await settle();
  for (const index of [1, 0, 1]) {
    page.type(page.labels()[index]!.toLowerCase());
    await settle();
  }
  assert.deepEqual(page.copied.at(-1), "two\none");
  assert.equal(page.messages().at(-1), "Copied 2 texts");
  page.escape();
});

test("rapid copy_text skips an empty pick, so the list has no blank line", async () => {
  const page = await page_with(["one", "two"]);
  page.links[0]!.textContent = "";
  page.run({ action: "copy_text", rapid: true });
  await settle();
  for (const index of [0, 1]) {
    page.type(page.labels()[index]!.toLowerCase());
    await settle();
  }
  assert.equal(page.copied.at(-1), "two");
  page.escape();
});

test("hint_remove from the background drops its matches, and every run asks again, so an edit applies to the next run", async () => {
  const page = await page_with(["one", "two", "three"]);
  page.set_hint_selectors({ hint_remove: [".text-two"] });
  page.run({ filter: "links" });
  await settle();
  assert.equal(page.labels().length, 2);
  page.escape();
  page.set_hint_selectors({});
  page.run({ filter: "links" });
  await settle();
  assert.equal(page.labels().length, 3);
  assert.equal(page.selector_asks(), 2);
  page.escape();
});

test("a rapid session asks for the selectors once, at its start", async () => {
  const page = await page_with(["one", "two", "three"]);
  page.set_hint_selectors({ hint_remove: [".text-three"] });
  page.run({ action: "background", rapid: true });
  await settle();
  page.type(page.labels()[0]!.toLowerCase());
  await settle();
  assert.equal(page.labels().length, 2);
  assert.equal(page.selector_asks(), 1);
  page.escape();
});

test("a hint selector that does not parse is skipped with one notice, and the others still apply", async () => {
  const page = await page_with(["one", "two", "three"]);
  page.set_hint_selectors({ hint_add: ["a["], hint_remove: ["div[", ".text-one"] });
  page.run({ filter: "links" });
  await settle();
  assert.equal(page.labels().length, 2);
  assert.deepEqual(page.toasts, ["Skipped hint selectors that do not parse: a[, div["]);
  page.escape();
});

test("a second hint.run while the first waits for its selectors cancels the first, and one set of labels shows", async () => {
  const page = await page_with(["one", "two"]);
  const first = page.run({ action: "background" });
  const second = page.run({ action: "background" });
  assert.deepEqual(await first, { ok: true, cancelled: true });
  await settle();
  assert.equal(page.labels().length, 2);
  assert.equal(await peek(second), undefined);
  page.escape();
  assert.deepEqual(await second, { ok: true, cancelled: true });
});

test("hints start with no site selectors when the ask fails", async () => {
  const page = await page_with(["one", "two"]);
  page.set_hint_selectors(() => Promise.reject(new Error("no background")));
  page.run({ filter: "links" });
  await settle();
  assert.equal(page.labels().length, 2);
  page.escape();
});

test("hints start with no site selectors when the background never answers, and keys typed meanwhile reach hint mode", async () => {
  const page = await page_with(["one", "two"]);
  page.set_hint_selectors(() => new Promise(() => {}));
  page.run({ filter: "links" });
  page.type("j");
  await new Promise((resolve) => setTimeout(resolve, 2100));
  await settle();
  assert.equal(page.mode(), "hint");
  assert.equal(page.labels().length, 2);
  assert.deepEqual(page.held_key_batches, []);
  page.escape();
});
