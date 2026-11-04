// The `hints` bundle: registers the hint sink and the `hint.run` handler with the host.
// `hint.run` enters hint mode at once, finds and labels the visible elements, then waits for a label to be typed.

import { CONFIG_STATUS_STORAGE_KEY } from "../../background/storage_keys.ts";
import type { BundleHostApi } from "../bundle_host.ts";
import { link_address, OPEN_PLACES, perform, starts_caret } from "./actions.ts";
import type { CaretMode, HintAction, Place } from "./actions.ts";
import { copy_text } from "../caret/copy_text.ts";
import { collect, has_text, selector_for } from "./candidates.ts";
import type { Found, HintFilter } from "./candidates.ts";
import { clean_letters, make_labels } from "./labels.ts";
import { create_picker } from "./pick.ts";
import { create_view } from "./view.ts";
import { follow_windows } from "./follow.ts";
import { keep_visible, uncovered_through_frames } from "./visible.ts";
import type { PageProbe } from "./visible.ts";

type HintsWindow = { oasisfox_host: BundleHostApi; oasisfox_hints_ready?: true; oasisfox_caret_target?: Element };
const page = window as unknown as HintsWindow;

type Session = {
  cancelled: boolean;
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
  ready?: { picker: ReturnType<typeof create_picker>; found: Found[]; view: ReturnType<typeof create_view>; stop_following: () => void };
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
  return collect(document, selector_for(filter, custom_selector)).filter((found) => !opens_elsewhere || link_address(found.element as HTMLAnchorElement) !== undefined);
}

async function keep_visible_ones(candidates: Found[]): Promise<Found[]> {
  const seen = await observe_intersecting(candidates.map((found) => found.element));
  const probe: PageProbe<Found> = {
    is_intersecting: (found) => seen.has(found.element),
    rects_of: (found) => {
      const lines = Array.from(found.element.getClientRects());
      return lines.length > 0 ? lines : [found.element.getBoundingClientRect()];
    },
    viewport_of: (found) => ({ width: window_of(found.element).innerWidth, height: window_of(found.element).innerHeight }),
    is_hidden_by_style: (found) => window_of(found.element).getComputedStyle(found.element).visibility === "hidden",
    is_reachable_at: (found, x, y) => uncovered_through_frames(found, x, y),
  };
  return keep_visible(candidates, probe);
}

async function read_letters(): Promise<string[]> {
  const stored = await browser.storage.local.get(CONFIG_STATUS_STORAGE_KEY);
  const status = stored[CONFIG_STATUS_STORAGE_KEY] as { settings?: { hint_letters?: unknown } } | undefined;
  return clean_letters(status?.settings?.hint_letters);
}

function copy_to_clipboard(text: string): void {
  void copy_text(navigator.clipboard, text).then((copied) => {
    // A view of its own, so the notice does not wipe the labels that rapid mode shows.
    create_view().show_message(copied ? `Copied ${text.length > 40 ? text.slice(0, 40) + "..." : text}` : "Could not copy to the clipboard");
  });
}

// `from_hints` keeps the router from storing this `open.url`, so `.` shows hints again instead of reopening the address.
function open_link(url: string, place: Place): void {
  void browser.runtime.sendMessage({ type: "run", invocations: [{ id: "open.url", args: { url, where: place } }], mode: "normal", from_hints: true }).catch(() => undefined);
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
    session = undefined;
  }

  // Finds, labels and shows the hints. Keys typed meanwhile wait and replay. Rapid mode calls it again after each pick.
  async function build(current: Session, candidates: Found[], first_build: boolean): Promise<void> {
    const [letters, visible] = await Promise.all([read_letters(), keep_visible_ones(candidates)]);
    if (current.cancelled) return;
    const found = current.lower_text === undefined ? visible : visible.filter((item) => link_address(item.element as HTMLAnchorElement) !== undefined && has_text(item.element, current.lower_text!));
    const view = create_view();
    if (found.length === 0) {
      host.set_mode("normal");
      view.show_message(current.text === undefined ? "No hints on this page" : `No link matches ${current.text}`);
      return;
    }
    // One match needs no label. Only the first build does this, so rapid mode cannot repeat the same pick.
    if (first_build && current.lower_text !== undefined && found.length === 1) {
      host.set_mode("normal");
      perform(current.action, found[0]!.element as HTMLElement, deps);
      return;
    }
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
    const outcome = ready.picker.on_token(token);
    if (outcome.kind === "pass") return "pass";
    ready.view.show_progress(outcome.typed, new Set(outcome.still_possible));
    if (outcome.picked !== undefined) {
      const picked = ready.found[outcome.picked]!.element as HTMLElement;
      if (!current.rapid) {
        // Leave hint mode first: a picked field then raises insert mode through its own focus event.
        host.set_mode("normal");
        perform(current.action, picked, deps);
        return "handled";
      }
      // Rapid: the pick may delete or move elements, so drop these labels and label the page again.
      ready.stop_following();
      ready.view.clear_labels();
      delete current.ready;
      perform(current.action, picked, deps);
      if (!current.cancelled) void build(current, find_candidates(current.filter, current.custom_selector, current.action), false);
    }
    return "handled";
  }

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

  host.register_handler("hint.run", (args) => {
    const action = args.action as HintAction;
    end_session();
    const filter = args.filter as HintFilter;
    const custom_selector = args.selector as string | undefined;
    let candidates: Found[];
    try {
      candidates = find_candidates(filter, custom_selector, action);
    } catch {
      return create_view().show_message(`Invalid selector: ${custom_selector}`);
    }
    // With nothing to label the mode never changes, so keys held during the load run as normal keys.
    const text = (args.text as string | undefined) || undefined;
    void browser.runtime.sendMessage({ type: "record_repeat", invocation: { id: "hint.run", args } });
    if (candidates.length === 0) return create_view().show_message(text === undefined ? "No hints on this page" : `No link matches ${text}`);
    // A caret start ends hint mode on the first pick, so rapid has nothing to repeat.
    const current: Session = { cancelled: false, action, waiting_tokens: [], rapid: args.rapid === true && !starts_caret(action), filter, custom_selector, text, lower_text: text?.toLowerCase() };
    session = current;
    host.set_mode("hint");
    void build(current, candidates, true);
  });
}

// A second run would register a second copy and orphan the first copy's labels.
if (!page.oasisfox_hints_ready) {
  page.oasisfox_hints_ready = true;
  register(page.oasisfox_host);
}
