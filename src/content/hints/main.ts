// The `hints` bundle: registers the hint sink and the `hint.run` handler with the host.
// `hint.run` enters hint mode at once, finds and labels the visible elements, then waits for a label to be typed.

import { CONFIG_STATUS_STORAGE_KEY } from "../../background/storage_keys.ts";
import type { BundleHostApi } from "../bundle_host.ts";
import { link_address, OPEN_PLACES, perform, UNBUILT_ACTIONS } from "./actions.ts";
import type { HintAction, Place } from "./actions.ts";
import { collect, selector_for } from "./candidates.ts";
import type { Found, HintFilter } from "./candidates.ts";
import { clean_letters, make_labels } from "./labels.ts";
import { create_picker } from "./pick.ts";
import { create_view } from "./view.ts";
import { follow_windows } from "./follow.ts";
import { keep_visible, uncovered_through_frames } from "./visible.ts";
import type { PageProbe } from "./visible.ts";

type HintsWindow = { oasisfox_host: BundleHostApi; oasisfox_hints_ready?: true };
const page = window as unknown as HintsWindow;

type Session = {
  cancelled: boolean;
  action: HintAction;
  // Keys typed while the elements are still being found.
  waiting_tokens: string[];
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
    rect_of: (found) => found.element.getBoundingClientRect(),
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

function open_link(url: string, place: Place): void {
  void browser.runtime.sendMessage({ type: "run", invocations: [{ id: "open.url", args: { url, where: place } }], mode: "normal" });
}

function register(host: BundleHostApi): void {
  let session: Session | undefined;

  function end_session(): void {
    session?.ready?.stop_following();
    session?.ready?.view.clear_labels();
    if (session) session.cancelled = true;
    session = undefined;
  }

  function handle_token(current: Session, token: string): "handled" | "pass" {
    const ready = current.ready!;
    const outcome = ready.picker.on_token(token);
    if (outcome.kind === "pass") return "pass";
    ready.view.show_progress(outcome.typed, new Set(outcome.still_possible));
    if (outcome.picked !== undefined) {
      const picked = ready.found[outcome.picked]!.element as HTMLElement;
      // Leave hint mode first: a picked field then raises insert mode through its own focus event.
      host.set_mode("normal");
      perform(current.action, picked, { open_link });
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
    if (UNBUILT_ACTIONS.includes(action)) throw new Error(`hint ${action} is not built yet (phase 2)`);
    end_session();
    const candidates = find_candidates(args.filter as HintFilter, args.selector as string | undefined, action);
    // With nothing to label the mode never changes, so keys held during the load run as normal keys.
    if (candidates.length === 0) return create_view().show_message("No hints on this page");
    const current: Session = { cancelled: false, action, waiting_tokens: [] };
    session = current;
    host.set_mode("hint");
    void (async () => {
      const [letters, found] = await Promise.all([read_letters(), keep_visible_ones(candidates)]);
      if (current.cancelled) return;
      const view = create_view();
      if (found.length === 0) {
        host.set_mode("normal");
        view.show_message("No hints on this page");
        return;
      }
      const labels = make_labels(found.length, letters);
      view.show(found.map((item, index) => ({ found: item, text: labels[index]! })));
      current.ready = { picker: create_picker(labels), found, view, stop_following: follow_windows(windows_of(found), view.reposition) };
      for (const token of current.waiting_tokens.splice(0)) {
        if (current.cancelled) break;
        handle_token(current, token);
      }
    })();
  });
}

// A second run would register a second copy and orphan the first copy's labels.
if (!page.oasisfox_hints_ready) {
  page.oasisfox_hints_ready = true;
  register(page.oasisfox_host);
}
