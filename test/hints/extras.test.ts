// The hint lifecycle for rapid mode, text, copy and a custom selector, run on a fake page.
import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/commands/hint.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import type { Outcome } from "../../src/shared/messages.ts";
import { registry } from "../../src/shared/registry/index.ts";

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

const settle = async () => {
  for (let turn = 0; turn < 6; turn++) await new Promise((resolve) => setTimeout(resolve, 0));
};

let import_count = 0;

// Builds a page of links with the given texts and loads the hints bundle against it.
async function page_with(texts: string[]) {
  const document_root = new FakeNode();
  const links: Link[] = [];
  const active_listeners = new Set<string>();
  const sent: unknown[] = [];
  const repeat_records: unknown[] = [];
  const copied: string[] = [];
  const modes: string[] = [];
  const handlers = new Map<string, (args: Record<string, unknown>) => unknown>();
  let sink: { on_token: (token: string) => string; exit: () => void } | undefined;
  let mode = "normal";

  const win = {
    innerWidth: 800,
    innerHeight: 600,
    getComputedStyle: () => ({ visibility: "visible" }),
    addEventListener: (type: string) => void active_listeners.add(type),
    removeEventListener: (type: string) => void active_listeners.delete(type),
    oasisfox_host: {
      register_sink: (_mode: string, registered: typeof sink) => void (sink = registered),
      register_handler: (id: string, handler: (args: Record<string, unknown>) => unknown) => void handlers.set(id, handler),
      // The real host calls the sink's exit when the mode leaves hint.
      set_mode: (next: string) => {
        modes.push(next);
        const left_hint = mode === "hint" && next !== "hint";
        mode = next;
        if (left_hint) sink?.exit();
      },
      show_toast: () => {},
    },
  };
  const doc = {
    documentElement: document_root,
    defaultView: win,
    createElement: () => new FakeNode(),
    elementFromPoint: () => null,
    querySelectorAll: () => [...links],
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
      remove: () => void links.splice(links.indexOf(node), 1),
      focus: () => {},
    });
    return node;
  };
  links.push(...texts.map(make_link));
  const globals = globalThis as Record<string, unknown>;
  globals.window = win;
  globals.document = doc;
  globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);
  globals.IntersectionObserver = class {
    callback: (entries: unknown[]) => void;
    constructor(callback: (entries: unknown[]) => void) {
      this.callback = callback;
    }
    targets: unknown[] = [];
    // One callback with every target, as the browser delivers the first observation.
    observe = (target: unknown) => {
      if (this.targets.push(target) === 1) queueMicrotask(() => this.callback(this.targets.map((each) => ({ isIntersecting: true, target: each }))));
    };
    disconnect = () => {};
  };
  globals.browser = { storage: { local: { get: async () => ({}) } }, runtime: { sendMessage: async (message: unknown) => void ((message as { type?: string }).type === "record_repeat" ? repeat_records : sent).push(message) } };
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
    repeat_records,
    copied,
    modes,
    mode: () => mode,
    active_listeners,
    // What the handler answers: an Outcome now, or a promise that stays pending while hints wait for the user.
    run: (args: Record<string, unknown>) => handlers.get("hint.run")!({ action: "here", filter: "links", rapid: false, ...args }) as Outcome | Promise<Outcome>,
    type: (token: string) => sink!.on_token(token),
    escape: () => win.oasisfox_host.set_mode("normal"),
    // The label text of each label that is not hidden by typing.
    labels: () => nodes_with_class("oasisfox-hint").filter((node) => node.style.display !== "none").map((node) => node.children.map((part) => part.textContent).join("")),
    label_tops: () => nodes_with_class("oasisfox-hint").map((node) => node.style.top),
    messages: () => nodes_with_class("oasisfox-hint-message").map((node) => node.textContent),
    host_count: () => document_root.children.length,
    caret_target: () => win as unknown as { oasisfox_caret_target?: unknown },
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
  assert.match(rapid_page.messages()[0]!, /^Copied two/);
  rapid_page.escape();
});

test("an invalid custom selector shows a notice instead of throwing", async () => {
  const page = await page_with(["one"]);
  let outcome: Outcome | Promise<Outcome> | undefined;
  assert.doesNotThrow(() => (outcome = page.run({ filter: "custom", selector: "a[" })));
  assert.deepEqual(outcome, { ok: false, message: "Invalid selector: a[" });
  assert.deepEqual(page.messages(), []);
  assert.deepEqual(page.modes, []);
});

test("hint.run needs no text: it defaults to empty, which filters nothing", () => {
  const checked = check_args(registry.get("hint.run")!, { action: "here" });
  assert.deepEqual(checked, { ok: true, args: { action: "here", filter: "clickable", text: "", rapid: false } });
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
  assert.deepEqual(page.run({ text: "zzz" }), { ok: false, message: "No link matches zzz" });
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

test("caret and visual hand the picked element to the caret bundle and enter that mode, also with rapid", async () => {
  for (const action of ["caret", "visual"]) {
    const page = await page_with(["one", "two"]);
    page.run({ action, rapid: true });
    await settle();
    page.type(page.labels()[1]!.toLowerCase());
    await settle();
    assert.equal(page.caret_target().oasisfox_caret_target, page.links[1]);
    assert.equal(page.mode(), action);
    assert.equal(page.labels().length, 0);
  }
});

test("caret with one text match starts at once at that link", async () => {
  const page = await page_with(["one", "two"]);
  page.run({ action: "caret", text: "two" });
  await settle();
  assert.equal(page.caret_target().oasisfox_caret_target, page.links[1]);
  assert.equal(page.mode(), "caret");
});

test("a hint start tells the background what `.` shows again, and a pick that opens a link is marked from_hints", async () => {
  const page = await page_with(["one", "two"]);
  const args = { action: "tab", filter: "links", text: "", rapid: true };
  page.run(args);
  await settle();
  page.type(page.labels()[0]!.toLowerCase());
  await settle();
  const record = { type: "record_repeat", invocation: { id: "hint.run", args } };
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
