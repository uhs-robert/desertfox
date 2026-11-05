// The `hints` bundle: registers the hint sink and the `hint.run` handler with the host.
// `hint.run` enters hint mode at once, finds and labels the visible elements, then waits for a label to be typed.

import type { Outcome } from "../../shared/messages.ts";
import { CONFIG_STATUS_STORAGE_KEY } from "../../background/storage_keys.ts";
import type { BundleHostApi } from "../bundle_host.ts";
import { unhover } from "./hover.ts";
import { link_address, OPEN_PLACES, perform, starts_caret } from "./actions.ts";
import type { CaretMode, HintAction, Place } from "./actions.ts";
import { copy_text } from "../caret/copy_text.ts";
import { collect, has_text, keep_present, keep_visible_deduplicated, query_for, weak_test_for } from "./candidates.ts";
import type { Found, HintFilter } from "./candidates.ts";
import { clean_letters, make_labels } from "./labels.ts";
import { create_picker } from "./pick.ts";
import { create_list_view } from "./list_view.ts";
import { create_view } from "./view.ts";
import type { HintView } from "./view.ts";
import { follow_windows } from "./follow.ts";
import { box_owners, boxes_with_fallback, scroll_clips_of, uncovered_through_frames, viewport_size } from "./visible.ts";
import type { PageProbe, Rect } from "./visible.ts";

type HintsWindow = { oasisfox_host: BundleHostApi; oasisfox_hints_ready?: true; oasisfox_caret_target?: Element };
const page = window as unknown as HintsWindow;

const done: Outcome = { ok: true };
const cancelled_outcome: Outcome = { ok: true, cancelled: true };

// What a session needs from its labels: the hint labels over the page, or the headings panel.
type LabelView = Pick<HintView, "show" | "show_progress" | "clear_labels" | "reposition"> & { scroll_by?: (panel_heights: number) => void };

type Session = {
  cancelled: boolean;
  // Set at the first pick. Only that pick answers `hint.run`, so a later rapid pick that fails shows its own message.
  picked?: true;
  // The hint.run args, which `.` repeats after a pick.
  args: Record<string, unknown>;
  // Settles the promise `hint.run` returned. The first call wins, so each path that leaves hint mode must call it before `set_mode`, because the mode change ends the session as cancelled.
  finish: (outcome: Outcome | Promise<Outcome>) => void;
  action: HintAction;
  // Keys typed while the elements are still being found.
  waiting_tokens: string[];
  // Rapid mode picks again after each pick.
  rapid: boolean;
  filter: HintFilter;
  custom_selector: string | undefined;
  // The `text` param as typed, and lower-cased for the match. Both are undefined without it.
  text: string | undefined;
  lower_text: string | undefined;
  ready?: { picker: ReturnType<typeof create_picker>; found: Found[]; view: LabelView; stop_following: () => void };
};

function observe_intersecting(elements: Element[]): Promise<Set<Element>> {
  if (elements.length === 0) return Promise.resolve(new Set());
  return new Promise((resolve) => {
    const observer = new IntersectionObserver((entries) => {
      observer.disconnect();
      resolve(new Set(entries.filter((entry) => entry.isIntersecting).map((entry) => entry.target)));
    });
    for (const element of elements) observer.observe(element);
  });
}

const window_of = (element: Element): Window => element.ownerDocument.defaultView ?? window;

// The top window plus every same-origin frame window that holds a candidate: a scroll inside a frame moves its labels too.
function windows_of(found: Found[]): Window[] {
  const frame_windows = found.flatMap((item) => item.frames.map((frame) => (frame as HTMLIFrameElement).contentWindow));
  return [...new Set([window, ...frame_windows])].filter((win): win is Window => win !== null);
}

// Opening in another place needs an address, so only links qualify.
function find_candidates(filter: HintFilter, custom_selector: string | undefined, action: HintAction): Found[] {
  const opens_elsewhere = OPEN_PLACES.includes(action);
  return collect(document, query_for(filter, custom_selector), weak_test_for(filter)).filter((found) => !opens_elsewhere || link_address(found.element as HTMLAnchorElement) !== undefined);
}

const parent_of = (element: Element): Element | null => element.parentElement ?? (element.parentNode as ShadowRoot | null)?.host ?? null;

function scroll_clips_in_page(element: Element): Rect[] {
  const win = window_of(element);
  return scroll_clips_of(element, {
    parent_of,
    tag_of: (e) => e.localName,
    style_of: (e) => {
      const style = win.getComputedStyle(e);
      return { position: style.position, display: style.display, overflow_x: style.overflowX, overflow_y: style.overflowY };
    },
    box_of: (e) => {
      const box = e.getBoundingClientRect();
      const left = box.left + e.clientLeft;
      const top = box.top + e.clientTop;
      return { left, top, right: left + e.clientWidth, bottom: top + e.clientHeight };
    },
  });
}

// The headings list takes headings off screen too, so it checks only that each has a box a person could read.
function keep_present_headings(candidates: Found[]): Found[] {
  const own_rects = (element: Element) => Array.from(element.getClientRects());
  const children = (element: Element) => Array.from(element.children);
  const keep_present_elements = (elements: Element[]) =>
    new Set(
      keep_present(elements, {
        rects_of: (element) => boxes_with_fallback(element, own_rects, children),
        clips_of: scroll_clips_in_page,
        // `checkVisibility` also catches the content of a closed `<details>`, which Firefox still gives a box.
        is_hidden: (element) => !element.checkVisibility({ visibilityProperty: true, opacityProperty: true }),
      }),
    );
  // A heading in a hidden or clipped frame is as hidden as the frame, so each frame passes the same rules as the heading.
  const kept_frames = keep_present_elements([...new Set(candidates.flatMap((found) => found.frames))]);
  const kept_elements = keep_present_elements(candidates.map((found) => found.element));
  return candidates.filter((found) => kept_elements.has(found.element) && found.frames.every((frame) => kept_frames.has(frame)));
}

const none_message = (filter: HintFilter, text: string | undefined): string =>
  filter === "headings" ? "No headings on this page" : text === undefined ? "No hints on this page" : `No link matches ${text}`;

// How far each key moves the headings panel, in panel heights.
const PANEL_SCROLL_KEYS: Record<string, number> = { "<PageDown>": 1, "<PageUp>": -1, "<C-d>": 0.5, "<C-u>": -0.5 };

async function keep_visible_ones(candidates: Found[]): Promise<Found[]> {
  const own_rects = (element: Element) => Array.from(element.getClientRects());
  const children = (element: Element) => Array.from(element.children);
  const owners = new Map(candidates.map((found) => [found.element, box_owners(found.element, own_rects, children)]));
  const seen = await observe_intersecting([...new Set([...owners.values()].flat())]);
  const probe: PageProbe<Found> = {
    is_intersecting: (found) => owners.get(found.element)!.some((owner) => seen.has(owner)),
    rects_of: (found) => boxes_with_fallback(found.element, own_rects, children),
    clips_of: (found) => scroll_clips_in_page(found.element),
    viewport_of: (found) => viewport_size(found.element.ownerDocument, window_of(found.element)),
    is_hidden_by_style: (found) => window_of(found.element).getComputedStyle(found.element).visibility === "hidden",
    is_reachable_at: (found, x, y) => uncovered_through_frames(found, x, y),
  };
  return keep_visible_deduplicated(candidates, probe);
}

async function read_letters(): Promise<string[]> {
  const stored = await browser.storage.local.get(CONFIG_STATUS_STORAGE_KEY);
  const status = stored[CONFIG_STATUS_STORAGE_KEY] as { settings?: { hint_letters?: unknown } } | undefined;
  return clean_letters(status?.settings?.hint_letters);
}

// A refused copy answers failed and shows nothing here: the pick's answer carries it to the caller, which shows it once.
function copy_to_clipboard(text: string): Promise<Outcome | undefined> {
  return copy_text(navigator.clipboard, text).then((copied) => {
    if (!copied) return { ok: false, message: "Could not copy to the clipboard" };
    // A view of its own, so the notice does not wipe the labels that rapid mode shows.
    create_view().show_message(`Copied ${text.length > 40 ? text.slice(0, 40) + "..." : text}`);
  });
}

// `from_hints` keeps the router from storing this `open.url`, so `.` shows hints again instead of reopening the address.
function open_link(url: string, place: Place): Promise<unknown> {
  return browser.runtime.sendMessage({ type: "run", invocations: [{ id: "open.url", args: { url, where: place } }], mode: "normal", from_hints: true });
}

// The caret bundle reads the element in `start_session` when the mode starts, and loads on that first entry.
function start_caret(target: Element, mode: CaretMode): void {
  page.oasisfox_caret_target = target;
  page.oasisfox_host.set_mode(mode);
}

const deps = { open_link, copy: copy_to_clipboard, start_caret };

function register(host: BundleHostApi): void {
  let session: Session | undefined;

  function end_session(): void {
    session?.ready?.stop_following();
    session?.ready?.view.clear_labels();
    if (session) session.cancelled = true;
    session?.finish(cancelled_outcome);
    session = undefined;
  }

  // A pick records what `.` repeats, so Escape or a failed filter stores nothing. The wait ends when the returned function gets the
  // action's result, so a later step sees the opened tab or the copied text. Call it before `set_mode`, which ends the session as cancelled.
  function begin_pick(current: Session): (run: () => unknown) => void {
    let answer!: (outcome: Outcome) => void;
    const first = !current.picked;
    current.picked = true;
    current.finish(new Promise<Outcome>((resolve) => (answer = resolve)));
    void browser.runtime.sendMessage({ type: "record_repeat", invocation: { id: "hint.run", args: current.args } });
    const ended = (result: unknown) => {
      let outcome = (result as Outcome | undefined) ?? done;
      // A refused open comes back as a RunResponse with no message. The background already showed it, so it only stops the sequence.
      if (!outcome.ok && typeof outcome.message !== "string") outcome = { ok: true, cancelled: true };
      if (first) answer(outcome);
      else if (!outcome.ok) create_view().show_message(outcome.message);
    };
    // A throw from the action is a failed pick, and a rejected open means the page went away, which cancels.
    return (run) => {
      let result: unknown;
      try {
        result = run();
      } catch (error) {
        result = { ok: false, message: String((error as Error)?.message ?? error) };
      }
      void Promise.resolve(result).then(ended, () => ended({ ok: true, cancelled: true }));
    };
  }

  // Finds, labels and shows the hints. Keys typed meanwhile wait and replay. Rapid mode calls it again after each pick.
  async function build(current: Session, candidates: Found[], first_build: boolean): Promise<void> {
    const [letters, visible] = await Promise.all([read_letters(), current.filter === "headings" ? keep_present_headings(candidates) : keep_visible_ones(candidates)]);
    if (current.cancelled) return;
    const found = current.lower_text === undefined ? visible : visible.filter((item) => link_address(item.element as HTMLAnchorElement) !== undefined && has_text(item.element, current.lower_text!));
    if (found.length === 0) {
      const message = none_message(current.filter, current.text);
      current.finish({ ok: false, message });
      host.set_mode("normal");
      // Only a rapid rebuild gets here with its promise already settled, so nobody else shows the message.
      if (!first_build) create_view().show_message(message);
      return;
    }
    // One match needs no label. Only the first build does this, so rapid mode cannot repeat the same pick.
    if (first_build && current.lower_text !== undefined && found.length === 1) {
      const performed = begin_pick(current);
      host.set_mode("normal");
      performed(() => perform(current.action, found[0]!.element as HTMLElement, deps, found[0]!.frames as HTMLElement[]));
      return;
    }
    const view = current.filter === "headings" ? create_list_view() : create_view();
    const labels = make_labels(found.length, letters);
    view.show(found.map((item, index) => ({ found: item, text: labels[index]! })));
    current.ready = { picker: create_picker(labels), found, view, stop_following: follow_windows(windows_of(found), view.reposition) };
    const queued = current.waiting_tokens.splice(0);
    for (const [index, token] of queued.entries()) {
      if (current.cancelled) break;
      // A rapid pick starts the next build, which replays the keys that are left.
      if (!current.ready) {
        current.waiting_tokens.unshift(...queued.slice(index));
        break;
      }
      handle_token(current, token);
    }
  }

  function handle_token(current: Session, token: string): "handled" | "pass" {
    const ready = current.ready!;
    const panel_scroll = PANEL_SCROLL_KEYS[token];
    // Never a label key: the panel is the only view with rows below its edge, and the others leave these keys to the page.
    if (panel_scroll !== undefined && ready.view.scroll_by) {
      ready.view.scroll_by(panel_scroll);
      return "handled";
    }
    const outcome = ready.picker.on_token(token);
    if (outcome.kind === "pass") return "pass";
    ready.view.show_progress(outcome.typed, new Set(outcome.still_possible));
    if (outcome.picked !== undefined) {
      const { element, frames } = ready.found[outcome.picked]!;
      const picked = element as HTMLElement;
      const performed = begin_pick(current);
      if (!current.rapid) {
        // Leave hint mode first: a picked field then raises insert mode through its own focus event.
        host.set_mode("normal");
        performed(() => perform(current.action, picked, deps, frames as HTMLElement[]));
        return "handled";
      }
      // Rapid: the pick may delete or move elements, so drop these labels and label the page again.
      ready.stop_following();
      ready.view.clear_labels();
      delete current.ready;
      performed(() => perform(current.action, picked, deps, frames as HTMLElement[]));
      if (!current.cancelled) void build(current, find_candidates(current.filter, current.custom_selector, current.action), false);
    }
    return "handled";
  }

  host.register_handler("hint.unhover", () => unhover());

  host.register_sink("hint", {
    on_token: (token) => {
      if (!session) return "pass";
      if (session.ready) return handle_token(session, token);
      if (token.length !== 1) return "pass";
      session.waiting_tokens.push(token);
      return "handled";
    },
    exit: end_session,
  });

  host.register_handler("hint.run", (args): Outcome | Promise<Outcome> => {
    const action = args.action as HintAction;
    end_session();
    const filter = args.filter as HintFilter;
    const custom_selector = args.selector as string | undefined;
    let candidates: Found[];
    try {
      candidates = find_candidates(filter, custom_selector, action);
    } catch {
      return { ok: false, message: `Invalid selector: ${custom_selector}` };
    }
    // With nothing to label the mode never changes, so keys held during the load run as normal keys.
    const text = (args.text as string | undefined) || undefined;
    if (candidates.length === 0) return { ok: false, message: none_message(filter, text) };
    // Pending until the user picks a label or leaves hint mode.
    return new Promise<Outcome>((finish) => {
      // A caret start ends hint mode on the first pick, so rapid has nothing to repeat.
      const current: Session = { cancelled: false, args, finish, action, waiting_tokens: [], rapid: args.rapid === true && !starts_caret(action), filter, custom_selector, text, lower_text: text?.toLowerCase() };
      session = current;
      host.set_mode("hint");
      void build(current, candidates, true);
    });
  });
}

// A second run would register a second copy and orphan the first copy's labels.
if (!page.oasisfox_hints_ready) {
  page.oasisfox_hints_ready = true;
  register(page.oasisfox_host);
}
