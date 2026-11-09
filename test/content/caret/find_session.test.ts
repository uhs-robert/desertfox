import assert from "node:assert/strict";
import { test } from "node:test";
import { create_find, is_page_change, page_watcher } from "../../../src/content/caret/find_session.ts";
import type { FindDeps } from "../../../src/content/caret/find_session.ts";
import type { ScanRegex } from "../../../src/content/caret/find_match.ts";
import { scan_regex } from "../../../src/background/regex_scan.ts";
import type { TextModel } from "../../../src/content/caret/text_model.ts";

// A page of "ab ab ab": matches of "ab" start at 0, 3 and 6.
function fake_page(page_text = "ab ab ab") {
  const painted_: { current: number; count: number }[] = [];
  const toasts: string[] = [];
  const registers = new Map<string, string>();
  const gates: (() => void)[] = [];
  let clears = 0;
  let selection = ["start"];
  let clock = 0;
  const watchers: (() => void)[] = [];
  let retargets = 0;
  let builds = 0;
  const pending_hosts_: unknown[] = [];
  // The background scan, answered in place after one gate, so a newer keystroke can arrive while it runs.
  let background: ScanRegex = async (text, { source, flags }) => ({ ok: true, ...scan_regex({ text, source, flags }) });
  const make_model = (): TextModel =>
    (builds++, { text: page_text, trees: [], empty_trees_: [], pending_hosts_: [...pending_hosts_], frames: [], point_at_: (index: number) => ({ node: { index }, offset: 0 }), index_of_: (node: { index: number }) => node.index }) as unknown as TextModel;
  const deps: FindDeps = {
    build_model_: make_model,
    start_index_: () => 0,
    painter: {
      paint: (_model, matches, current) => (painted_.push({ current, count: matches.from.length }), 0),
      clear: () => void clears++,
    },
    scroll_to_: () => {},
    read_colors_: async () => ({ all: { dark: ["#1", "#2"], light: ["#1", "#2"] }, current: { dark: ["#1", "#2"], light: ["#1", "#2"] } }),
    get_register_: async (name) => registers.get(name),
    set_register_: async (name, text) => void registers.set(name, text),
    // Each match ends a slice, and the page runs only when the test lets the scan go on.
    slicing: (is_stale_) => ({ is_stale_, now: () => (clock += 10), slice_ms_: 8, yield_to_page_: () => new Promise<void>((resume) => gates.push(resume)) }),
    scan_regex: async (text, regex) => {
      await new Promise<void>((resume) => gates.push(resume));
      return background(text, regex);
    },
    selection_key_: () => selection,
    watch_page_: (on_change) => (watchers.push(on_change), () => void retargets++),
  };
  const settle = async () => {
    for (let round = 0; round < 30; round++) {
      while (gates.length > 0) gates.shift()!();
      await new Promise((resume) => setImmediate(resume));
    }
  };
  return { deps, pending_hosts_, retargets: () => retargets, builds: () => builds, change_page: () => watchers.forEach((notify) => notify()), painted_, toasts, registers, settle, clears: () => clears, set_selection: (next: string[]) => (selection = next), set_background: (next: ScanRegex) => (background = next), host: { show_toast_: (message: string) => void toasts.push(message) } };
}

test("a search begun while Enter waits for the old scan keeps its own state", async () => {
  const page = fake_page();
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  find.update("ab", () => {});
  const ending = find.end(true);
  find.begin("forward");
  await page.settle();
  await ending;
  find.update("ab", () => {});
  await page.settle();
  assert.equal(page.painted_.length > 0, true, "the new line found nothing");
  const before = page.clears();
  await find.end(false);
  assert.equal(page.clears(), before + 1, "Escape did not clear the highlights of the new line");
});

test("n right after Enter waits for the search to finish and then steps", async () => {
  const page = fake_page();
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  find.update("ab", () => {});
  void find.end(true);
  const stepping = find.step(false);
  await page.settle();
  await stepping;
  assert.deepEqual(page.toasts, ["2 of 3"]);
});

test("Escape clears the highlights, keeps the query and the match, and n goes on from it", async () => {
  const page = fake_page();
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  find.update("ab", () => {});
  await page.settle();
  const before = page.clears();
  await find.end(false);
  assert.equal(page.clears(), before + 1);
  assert.equal(page.registers.get("/"), "ab");
  assert.equal(page.registers.get("/:direction"), "forward");
  await find.step(false);
  assert.deepEqual(page.toasts, ["2 of 3"]);
  await find.step(true);
  assert.deepEqual(page.toasts, ["2 of 3", "1 of 3"]);
});

test("a caret session starts at the match until a later selection takes its place", async () => {
  const page = fake_page();
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  find.update("ab", () => {});
  await page.settle();
  await find.end(true);
  const model = page.deps.build_model_();
  assert.equal(find.position(model), 0);
  page.set_selection(["clicked"]);
  assert.equal(find.position(model), undefined);
});

test("n with no search made answers failed and shows nothing itself", async () => {
  const page = fake_page();
  const find = create_find(page.host, page.deps);
  assert.deepEqual(await find.step(false), { ok: false, message: "No previous search" });
  assert.deepEqual(page.toasts, []);
});

test("n answers done on a match and failed when the last search has no match any more", async () => {
  const page = fake_page();
  page.registers.set("/", "ab");
  page.registers.set("/:direction", "forward");
  const find = create_find(page.host, page.deps);
  const found = find.step(false);
  await page.settle();
  assert.deepEqual(await found, { ok: true });
  page.registers.set("/", "zz");
  const lost = create_find(page.host, page.deps).step(false);
  await page.settle();
  assert.deepEqual(await lost, { ok: false, message: "Not found: zz" });
  assert.deepEqual(page.toasts, ["1 of 3"]);
});

test("a step that a newer one replaced answers cancelled", async () => {
  const page = fake_page();
  page.registers.set("/", "ab");
  page.registers.set("/:direction", "forward");
  const find = create_find(page.host, page.deps);
  const first = find.step(false);
  find.begin("forward");
  await page.settle();
  assert.deepEqual(await first, { ok: true, cancelled: true });
});

test("two quick n presses move two matches, even when the register still has to be read", async () => {
  const page = fake_page();
  page.registers.set("/", "ab");
  page.registers.set("/:direction", "forward");
  const find = create_find(page.host, page.deps);
  const first = find.step(false);
  const second = find.step(false);
  await page.settle();
  await Promise.all([first, second]);
  assert.deepEqual(page.toasts, ["1 of 3", "2 of 3"]);
});

test("a search that finds nothing, or ends with Escape, does not keep the old match as the position", async () => {
  const page = fake_page();
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  find.update("ab", () => {});
  await page.settle();
  await find.end(true);
  const model = page.deps.build_model_();
  assert.equal(find.position(model), 0);
  find.begin("forward");
  find.update("zz", () => {});
  await page.settle();
  await find.end(false);
  assert.equal(find.position(model), undefined);
});

test("a costly pattern is not searched, says so, and leaves the older results in place", async () => {
  const page = fake_page();
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  const lines: string[] = [];
  find.update("(a+)", (status) => lines.push(status));
  await page.settle();
  const painted = page.painted_.length;
  const clears = page.clears();
  find.update("(a+)+", (status) => lines.push(status));
  await page.settle();
  assert.equal(page.painted_.length, painted);
  assert.equal(page.clears(), clears);
  assert.match(lines.at(-1)!, /too slow/);
});

test("a keystroke after a costly one searches again, and a newer keystroke still drops an older scan", async () => {
  const page = fake_page();
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  const lines: string[] = [];
  find.update("a", (status) => lines.push(`a:${status}`));
  find.update("(a+)+", (status) => lines.push(`costly:${status}`));
  find.update("ab", (status) => lines.push(`ab:${status}`));
  await page.settle();
  assert.deepEqual(lines.filter((line) => line.startsWith("a:")), []);
  assert.deepEqual(lines.at(-1), "ab:1 of 3");
  assert.equal(page.painted_.length, 1);
});

test("n on a costly last search searches its characters as text and does not hang", async () => {
  const page = fake_page();
  page.registers.set("/", "(a+)+$");
  page.registers.set("/:direction", "forward");
  const find = create_find(page.host, page.deps);
  assert.deepEqual(await find.step(false), { ok: false, message: "Not found: (a+)+$" });
});

test("Enter on a costly pattern scans its characters as text instead of leaving no match", async () => {
  const page = fake_page("x (a|b)+ y");
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  find.update("(a|b)+", () => {});
  await page.settle();
  assert.equal(page.painted_.length, 0, "the costly pattern was scanned while typing");
  const ending = find.end(true);
  await page.settle();
  await ending;
  assert.equal(page.painted_.length, 1);
  assert.equal(find.position(page.deps.build_model_()), 2);
});

test("a change to the page makes the next n read the model again, and no change keeps it", async () => {
  const page = fake_page();
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  find.update("ab", () => {});
  await page.settle();
  await find.end(true);
  const built = page.builds();
  await find.step(false);
  assert.equal(page.builds(), built, "an unchanged page was read again");
  page.change_page();
  await page.settle();
  const stepping = find.step(false);
  await page.settle();
  await stepping;
  assert.equal(page.builds(), built + 1);
});

test("a change to the page makes the next keystroke read the model again", async () => {
  const page = fake_page();
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  find.update("ab", () => {});
  await page.settle();
  const built = page.builds();
  page.change_page();
  find.update("ab ", () => {});
  await page.settle();
  assert.equal(page.builds(), built + 1);
});

test("a search that begins at a point looks past it going forward", async () => {
  const page = fake_page();
  const find = create_find(page.host, page.deps);
  const reports: string[] = [];
  find.begin("forward", { node: { index: 3 } as unknown as Node, offset: 0 });
  find.update("ab", (status) => reports.push(status));
  await page.settle();
  assert.equal(reports.at(-1), "3 of 3");
});

test("a jump searches from the word, forward past it and backward before it, and sets the last search", async () => {
  const page = fake_page();
  const find = create_find(page.host, page.deps);
  const from = { node: { index: 3 } as unknown as Node, offset: 0 };
  const forward = find.jump("ab", "forward", from);
  await page.settle();
  assert.deepEqual(await forward, { ok: true });
  assert.deepEqual(page.toasts, ["3 of 3"]);
  assert.equal(page.registers.get("/"), "ab");
  const backward = find.jump("ab", "backward", from);
  await page.settle();
  await backward;
  assert.equal(page.toasts.at(-1), "1 of 3");
  assert.equal(page.registers.get("/:direction"), "backward");
});

test("a rebuild during typing keeps the origin of a search that began at a point", async () => {
  const page = fake_page();
  const find = create_find(page.host, page.deps);
  const reports: string[] = [];
  find.begin("forward", { node: { index: 3 } as unknown as Node, offset: 0 });
  find.update("ab", (status) => reports.push(status));
  await page.settle();
  page.change_page();
  find.update("a", (status) => reports.push(status));
  await page.settle();
  assert.equal(reports.at(-1), "3 of 3");
});

test("the watcher is pointed at the trees of each model the search reads", async () => {
  const page = fake_page();
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  page.change_page();
  find.update("ab", () => {});
  await page.settle();
  assert.equal(page.retargets(), 2);
});

test("a step from a caret goes on from the caret and not from the last match", async () => {
  const page = fake_page();
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  find.update("ab", () => {});
  await page.settle();
  await find.end(true);
  const stepping = find.step(false, { node: { index: 3 } as unknown as Node, offset: 0 });
  await page.settle();
  await stepping;
  assert.deepEqual(page.toasts, ["3 of 3"]);
  const backward = find.step(true, { node: { index: 3 } as unknown as Node, offset: 0 });
  await page.settle();
  await backward;
  assert.equal(page.toasts.at(-1), "1 of 3");
});

test("nodes that DesertFox adds are not a page change, wherever they sit and whatever their style says", () => {
  const page_target = { nodeType: 1, closest: () => null };
  const own = (name: string) => ({ nodeType: 1, hasAttribute: (asked: string) => asked === name });
  const page_node = { nodeType: 1, hasAttribute: () => false };
  const record = (added: unknown[], removed: unknown[] = []) => ({ type: "childList", target: page_target, addedNodes: added, removedNodes: removed }) as unknown as MutationRecord;
  assert.equal(is_page_change(record([own("data-desertfox-layer")], [own("data-desertfox")])), false);
  assert.equal(is_page_change(record([own("data-desertfox-layer"), page_node])), true);
  assert.equal(is_page_change({ type: "characterData", target: page_target, addedNodes: [], removedNodes: [] } as unknown as MutationRecord), true);
});

test("a text change inside an element of DesertFox is not a page change", () => {
  const own_style = { nodeType: 1, closest: () => ({}) };
  const text = { nodeType: 3, parentElement: own_style };
  const style_rewrite = { type: "childList", target: own_style, addedNodes: [text], removedNodes: [text] } as unknown as MutationRecord;
  assert.equal(is_page_change(style_rewrite), false);
  assert.equal(is_page_change({ type: "characterData", target: text, addedNodes: [], removedNodes: [] } as unknown as MutationRecord), false);
});

// "a.*c" as a regex finds "abc" at 5. Searched as text it finds its own characters at 0.
const TIMES_OUT: ScanRegex = async () => ({ ok: false, reason: "timeout" });

test("a regex past the time limit says so while typing and leaves the older results in place", async () => {
  const page = fake_page("a.*c abc");
  page.set_background(TIMES_OUT);
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  const lines: string[] = [];
  find.update("a", (status) => lines.push(status));
  await page.settle();
  const painted = page.painted_.length;
  const clears = page.clears();
  find.update("a.*c", (status) => lines.push(status));
  await page.settle();
  assert.equal(page.painted_.length, painted);
  assert.equal(page.clears(), clears);
  assert.equal(lines.at(-1), "Pattern too slow, stopped after 0.3 s: a.*c");
});

test("Enter on a regex past the time limit searches it as text, and n then carries the note", async () => {
  const page = fake_page("a.*c abc a.*c");
  page.set_background(TIMES_OUT);
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  find.update("a.*c", () => {});
  await page.settle();
  assert.equal(page.painted_.length, 0);
  const ending = find.end(true);
  await page.settle();
  await ending;
  assert.equal(page.painted_.length, 1);
  assert.equal(find.position(page.deps.build_model_()), 0);
  const stepping = find.step(false);
  await page.settle();
  await stepping;
  assert.deepEqual(page.toasts, ["2 of 2 (too slow as a regex, searched as text)"]);
});

test("n on a last search that runs past the time limit searches it as text with the note", async () => {
  const page = fake_page("x a.*c abc");
  page.set_background(TIMES_OUT);
  page.registers.set("/", "a.*c");
  page.registers.set("/:direction", "forward");
  const find = create_find(page.host, page.deps);
  const stepping = find.step(false);
  await page.settle();
  assert.deepEqual(await stepping, { ok: true });
  assert.deepEqual(page.toasts, ["1 of 1 (too slow as a regex, searched as text)"]);
});

test("a search after a timeout runs as a regex again", async () => {
  const page = fake_page("a.*c abc");
  page.set_background(TIMES_OUT);
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  const lines: string[] = [];
  find.update("a.*c", (status) => lines.push(status));
  await page.settle();
  page.set_background(async (text, { source, flags }) => ({ ok: true, ...scan_regex({ text, source, flags }) }));
  find.update("a.c", (status) => lines.push(status));
  await page.settle();
  assert.equal(lines.at(-1), "1 of 1");
  await find.end(true);
  assert.equal(find.position(page.deps.build_model_()), 5);
});

test("a regex answer that comes back after a newer keystroke is dropped", async () => {
  const page = fake_page("a.*c abc");
  const answers: (() => void)[] = [];
  // The first scan answers only after the second keystroke has been searched.
  page.set_background((text, { source, flags }) => new Promise((resolve) => answers.push(() => resolve({ ok: true, ...scan_regex({ text, source, flags }) }))));
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  const lines: string[] = [];
  find.update("a.c", (status) => lines.push(`old:${status}`));
  await page.settle();
  find.update("abc", (status) => lines.push(`new:${status}`));
  await page.settle();
  answers.shift()!();
  await page.settle();
  assert.deepEqual(lines, ["new:1 of 1"]);
  assert.equal(page.painted_.length, 1);
});

test("a failed background scan shows a toast and the next keystroke searches again", async () => {
  const page = fake_page("a.*c abc");
  page.set_background(async () => ({ ok: false, reason: "failed", message: "worker broke" }));
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  find.update("a.c", () => {});
  await page.settle();
  assert.deepEqual(page.toasts, ["Search failed: worker broke"]);
  page.set_background(async (text, { source, flags }) => ({ ok: true, ...scan_regex({ text, source, flags }) }));
  const lines: string[] = [];
  find.update("a.c", (status) => lines.push(status));
  await page.settle();
  assert.deepEqual(lines, ["1 of 1"]);
});

const in_place: ScanRegex = async (text, { source, flags }) => ({ ok: true, ...scan_regex({ text, source, flags }) });

test("Enter after a timeout searches as text even when older results of the same query stay on the page", async () => {
  // As a regex "a.c" finds "abc" at 5. As text it finds nothing.
  const page = fake_page("a.*c abc");
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  find.update("a.c", () => {});
  await page.settle();
  page.set_background(TIMES_OUT);
  find.update("a.cd", () => {});
  await page.settle();
  find.update("a.c", () => {});
  await page.settle();
  const ending = find.end(true);
  await page.settle();
  await ending;
  assert.equal(find.position(page.deps.build_model_()), undefined, "Enter kept the matches of the older regex run");
});

test("a timeout stops counting_ once a later regex run of the same text answers", async () => {
  // As a regex the pattern finds nothing: the "c" is followed by "(", not "q". As text it finds itself at 0.
  const page = fake_page("a.*c(?=q) z");
  page.set_background(TIMES_OUT);
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  find.update("a.*c(?=q)", () => {});
  await page.settle();
  page.set_background(in_place);
  find.update("a.*c(?=", () => {});
  await page.settle();
  const lines: string[] = [];
  find.update("a.*c(?=q)", (status) => lines.push(status));
  await page.settle();
  assert.deepEqual(lines, ["Not found: a.*c(?=q)"]);
  const ending = find.end(true);
  await page.settle();
  await ending;
  assert.equal(find.position(page.deps.build_model_()), undefined, "Enter searched the pattern as text after the regex answered");
});

test("n on a pattern that timed out searches as text at once on each later press, even after the page changed", async () => {
  const page = fake_page("x a.*c abc");
  let scans = 0;
  page.set_background(async () => (scans++, { ok: false, reason: "timeout" }));
  page.registers.set("/", "a.*c");
  page.registers.set("/:direction", "forward");
  const find = create_find(page.host, page.deps);
  const first = find.step(false);
  await page.settle();
  await first;
  page.change_page();
  const second = find.step(false);
  await page.settle();
  await second;
  assert.equal(scans, 1, "the second n waited for the regex again");
  assert.deepEqual(page.toasts, ["1 of 1 (too slow as a regex, searched as text)", "1 of 1, wrapped (too slow as a regex, searched as text)"]);
});

test("n after Enter on a pattern that timed out does not run the regex again", async () => {
  const page = fake_page("a.*c abc a.*c");
  let scans = 0;
  page.set_background(async () => (scans++, { ok: false, reason: "timeout" }));
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  find.update("a.*c", () => {});
  await page.settle();
  const ending = find.end(true);
  await page.settle();
  await ending;
  page.change_page();
  const stepping = find.step(false);
  await page.settle();
  await stepping;
  assert.equal(scans, 1);
  assert.deepEqual(page.toasts, ["2 of 2 (too slow as a regex, searched as text)"]);
});

// A MutationObserver that records what it watches.
function fake_observer() {
  const watched: unknown[] = [];
  class FakeObserver {
    observe = (target: unknown) => void watched.push(target);
    disconnect = () => void (watched.length = 0);
  }
  return { observer_class: FakeObserver as unknown as typeof MutationObserver, watched };
}

function fake_frame() {
  const listeners: { fire: () => void; signal: AbortSignal }[] = [];
  return {
    frame: { addEventListener: (_type: string, fire: () => void, options: { signal: AbortSignal }) => void listeners.push({ fire, signal: options.signal }) } as unknown as Element,
    load: () => listeners.filter((listener) => !listener.signal.aborted).forEach((listener) => listener.fire()),
  };
}

test("the watcher observes shadow roots and frame documents that held no text", () => {
  (globalThis as { document?: unknown }).document = { name: "page" };
  const { observer_class, watched } = fake_observer();
  const empty_root = { name: "empty root" };
  const model = { trees: [{ name: "text root" }], empty_trees_: [empty_root], frames: [] } as unknown as TextModel;
  page_watcher(observer_class)(() => {})(model);
  assert.equal(watched.includes(empty_root), true);
});

test("a frame that loads after the model was built makes n read the page again", async () => {
  (globalThis as { document?: unknown }).document = { name: "page" };
  const { observer_class } = fake_observer();
  const { frame, load } = fake_frame();
  const page = fake_page();
  const watch = page_watcher(observer_class);
  const watch_page_: FindDeps["watch_page_"] = (on_change) => {
    const retarget = watch(on_change);
    return (model) => retarget({ ...model, frames: [frame] } as TextModel);
  };
  const find = create_find(page.host, { ...page.deps, watch_page_ });
  find.begin("forward");
  find.update("ab", () => {});
  await page.settle();
  await find.end(true);
  const before = page.builds();
  const stepping = find.step(false);
  await page.settle();
  await stepping;
  assert.equal(page.builds(), before, "n read the page again with nothing changed");
  load();
  const stepping_again = find.step(false);
  await page.settle();
  await stepping_again;
  assert.equal(page.builds() > before, true, "n kept the old model after the frame loaded");
});

test("a retarget drops the load listeners of the old model's frames", () => {
  (globalThis as { document?: unknown }).document = { name: "page" };
  const { observer_class } = fake_observer();
  const { frame, load } = fake_frame();
  let changes = 0;
  const retarget = page_watcher(observer_class)(() => void changes++);
  retarget({ trees: [], empty_trees_: [], frames: [frame] } as unknown as TextModel);
  retarget({ trees: [], empty_trees_: [], frames: [] } as unknown as TextModel);
  load();
  assert.equal(changes, 0, "a frame the new model no longer lists still raised a change");
});

// A custom element that gains a shadow root fires no mutation, so the model lists it and `n` checks the list.
async function step_after_host_change(host: Record<string, unknown>, change: () => void) {
  const page = fake_page();
  page.pending_hosts_.push(host);
  const find = create_find(page.host, page.deps);
  find.begin("forward");
  find.update("ab", () => {});
  await page.settle();
  await find.end(true);
  const step = async () => {
    const stepping = find.step(false);
    await page.settle();
    await stepping;
  };
  await step();
  const before = page.builds();
  await step();
  assert.equal(page.builds(), before, "n read the page again with nothing changed");
  change();
  page.pending_hosts_.length = 0;
  await step();
  const after_change = page.builds();
  await step();
  assert.equal(page.builds(), after_change, "n read the page again after the model took the new root");
  return { before, after_change };
}

test("n reads the page once after a custom element gains a shadow root", async () => {
  const host: Record<string, unknown> = { shadowRoot: null };
  const { before, after_change } = await step_after_host_change(host, () => (host.shadowRoot = {}));
  assert.equal(after_change, before + 1);
});

test("n reads the page once after a custom element gains a closed shadow root", async () => {
  const host: Record<string, unknown> = { shadowRoot: null, openOrClosedShadowRoot: null };
  const { before, after_change } = await step_after_host_change(host, () => (host.openOrClosedShadowRoot = {}));
  assert.equal(after_change, before + 1);
});
