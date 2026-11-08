// The `hints` bundle: registers the hint sink and the `hint.run` handler with the host.
// `hint.run` enters hint mode at once, finds and labels the visible elements, then waits for a label to be typed.

import type { Outcome } from "../../shared/messages.ts";
import { CONFIG_STATUS_STORAGE_KEY } from "../../background/storage_keys.ts";
import type { BundleHostApi } from "../bundle_host.ts";
import { unhover } from "./hover.ts";
import { has_usable_address, is_inside_link, is_media, OPEN_PLACES, perform, starts_caret } from "./actions.ts";
import type { CaretMode, HintAction, Place } from "./actions.ts";
import { copy_text } from "../caret/copy_text.ts";
import { collect, keep_text_matches, keep_visible_deduplicated, query_for, scroll_clips_in_page, weak_test_for, window_of } from "./candidates.ts";
import type { Found, HintFilter } from "./candidates.ts";
import { clean_letters, make_labels } from "./labels.ts";
import { create_picker } from "./pick.ts";
import { create_view } from "./view.ts";
import type { HintView } from "./view.ts";
import { follow_windows } from "./follow.ts";
import { box_owners, boxes_with_fallback, uncovered_through_frames, viewport_size } from "./visible.ts";
import type { PageProbe } from "./visible.ts";
import { clear_snapshot, go_to_heading, keep_present_found, take_snapshot } from "./headings.ts";
import { all_links, format_links, links_of } from "./yank_links.ts";
import type { LinkFormat } from "./yank_links.ts";
import { can_open_elsewhere, find_follow_link } from "./follow_links.ts";
import { focus_field } from "./focus_fields.ts";
import type { FieldDirection } from "./focus_fields.ts";
import type { FollowDirection } from "./follow_links.ts";
import { DEFAULT_SETTINGS } from "../../shared/default_settings.ts";
import type { HeadingItem } from "../../shared/messages.ts";

type HintsWindow = { desertfox_host: BundleHostApi; desertfox_hints_ready?: true; desertfox_caret_target?: Element };
const page = window as unknown as HintsWindow;

const done: Outcome = { ok: true };
const cancelled_outcome: Outcome = { ok: true, cancelled: true };

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
  // Only the images filter takes a picture from a CSS background.
  with_background: boolean;
  custom_selector: string | undefined;
  // The `text` param as typed, and lower-cased for the match. Both are undefined without it.
  text: string | undefined;
  lower_text: string | undefined;
  ready?: { picker: ReturnType<typeof create_picker>; found: Found[]; view: HintView; stop_following: () => void };
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

// The top window plus every same-origin frame window that holds a candidate: a scroll inside a frame moves its labels too.
function windows_of(found: Found[]): Window[] {
  const frame_windows = found.flatMap((item) => item.frames.map((frame) => (frame as HTMLIFrameElement).contentWindow));
  return [...new Set([window, ...frame_windows])].filter((win): win is Window => win !== null);
}

// A double-click skips links. Opening in another place needs an address, and an inline one cannot open. The images filter always needs one, so no label promises an image that a copy or an open cannot use.
function find_candidates(filter: HintFilter, custom_selector: string | undefined, action: HintAction): Found[] {
  const opens_elsewhere = OPEN_PLACES.includes(action);
  const with_background = filter === "images";
  const found = collect(document, query_for(filter, custom_selector), weak_test_for(filter));
  const outside_links = action === "double_click" ? found.filter((item) => !is_inside_link(item.element)) : found;
  return outside_links.filter((item) => (!opens_elsewhere && !with_background) || has_usable_address(item.element as HTMLElement, with_background, opens_elsewhere));
}

const none_message = (text: string | undefined): string => (text === undefined ? "No hints on this page" : `No link matches ${text}`);

async function keep_visible_ones(candidates: Found[], filter: HintFilter): Promise<Found[]> {
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
    // Site players lay click-catching controls over the video, and a card lays a stretched link over its picture, so a cover test would drop them.
    is_reachable_at: (found, x, y) => uncovered_through_frames(found, x, y, filter === "images" || (filter === "media" && is_media(found.element))),
  };
  return keep_visible_deduplicated(candidates, probe);
}

// The page scope takes every link that is present, the viewport scope only those in view.
async function yank_links(scope: "page" | "viewport", format: LinkFormat): Promise<Outcome> {
  const found = all_links();
  const kept = scope === "page" ? keep_present_found(found) : await keep_visible_ones(found, "links");
  const links = links_of(kept, document.URL);
  if (links.length === 0) return { ok: false, message: "No links on this page" };
  if (!(await copy_text(navigator.clipboard, format_links(links, format)))) return { ok: false, message: "Could not copy to the clipboard" };
  create_view().show_message(`Copied ${links.length} ${links.length === 1 ? "link" : "links"}`);
  return done;
}

async function read_setting(name: string): Promise<unknown> {
  const stored = await browser.storage.local.get(CONFIG_STATUS_STORAGE_KEY);
  const status = stored[CONFIG_STATUS_STORAGE_KEY] as { settings?: Record<string, unknown> } | undefined;
  return status?.settings?.[name];
}

async function read_letters(): Promise<string[]> {
  return clean_letters(await read_setting("hint_letters"));
}

async function read_patterns(direction: FollowDirection): Promise<string[]> {
  const name = direction === "next" ? "next_patterns" : "prev_patterns";
  const chosen = await read_setting(name);
  return Array.isArray(chosen) && chosen.every((entry) => typeof entry === "string") ? chosen : [...DEFAULT_SETTINGS[name]];
}

// A `<link>` has no box to click, so it navigates by its address.
async function follow_page_link(direction: FollowDirection, place: Place): Promise<Outcome> {
  const link = find_follow_link(document, direction, await read_patterns(direction));
  if (!link) return { ok: false, message: direction === "next" ? "No next page link" : "No previous page link" };
  const element = link.element as HTMLLinkElement;
  if (place !== "here" && !can_open_elsewhere(element)) return { ok: false, message: "That page link cannot open in another tab" };
  if (element.localName === "link") {
    if (place === "here") window.location.assign(element.href);
    else await open_link(element.href, place);
    return done;
  }
  const result = await perform(place, element, deps);
  return result && typeof result === "object" && "ok" in result ? (result as Outcome) : done;
}

// A refused copy answers failed and shows nothing here: the pick's answer carries it to the caller, which shows it once.
function copy_to_clipboard(text: string): Promise<Outcome | undefined> {
  return copy_text(navigator.clipboard, text).then((copied) => {
    if (!copied) return { ok: false, message: "Could not copy to the clipboard" };
    // A view of its own, so the notice does not wipe the labels that rapid mode shows.
    create_view().show_message(`Copied ${text.length > 40 ? text.slice(0, 40) + "..." : text}`);
  });
}

// The background answers an `Outcome`. A failed one carries the refusal to the caller, which shows it once.
function image_action(action: "copy_image" | "download", address: string): Promise<Outcome> {
  return browser.runtime.sendMessage({ type: "image_action", action, address }).then((outcome: Outcome | undefined) => {
    if (!outcome) return { ok: false, message: "The picture action got no answer" };
    if (outcome.ok) create_view().show_message(action === "copy_image" ? "Copied image" : "Started the download");
    return outcome;
  });
}

// `from_hints` keeps the router from storing this `open.url`, so `.` shows hints again instead of reopening the address.
function open_link(url: string, place: Place): Promise<unknown> {
  return browser.runtime.sendMessage({ type: "run", invocations: [{ id: "open.url", args: { url, where: place } }], mode: "normal", from_hints: true });
}

// The caret bundle reads the element in `start_session` when the mode starts, and loads on that first entry.
function start_caret(target: Element, mode: CaretMode): void {
  page.desertfox_caret_target = target;
  page.desertfox_host.set_mode(mode);
}

const deps = { open_link, copy: copy_to_clipboard, image_action, start_caret };

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
    const [letters, visible] = await Promise.all([read_letters(), keep_visible_ones(candidates, current.filter)]);
    if (current.cancelled) return;
    const found = current.lower_text === undefined ? visible : keep_text_matches(visible, current.lower_text);
    if (found.length === 0) {
      const message = none_message(current.text);
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
      performed(() => perform(current.action, found[0]!.element as HTMLElement, deps, current.with_background));
      return;
    }
    const view = create_view();
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
      const { element } = ready.found[outcome.picked]!;
      const picked = element as HTMLElement;
      const performed = begin_pick(current);
      if (!current.rapid) {
        // Leave hint mode first: a picked field then raises insert mode through its own focus event.
        host.set_mode("normal");
        performed(() => perform(current.action, picked, deps, current.with_background));
        return "handled";
      }
      // Rapid: the pick may delete or move elements, so drop these labels and label the page again.
      ready.stop_following();
      ready.view.clear_labels();
      delete current.ready;
      performed(() => perform(current.action, picked, deps, current.with_background));
      if (!current.cancelled) void build(current, find_candidates(current.filter, current.custom_selector, current.action), false);
    }
    return "handled";
  }

  host.register_handler("page.follow", (args) => follow_page_link(args.direction as FollowDirection, args.where as Place));
  host.register_handler("page.focus_field", (args): Outcome => {
    const message = focus_field(document, args.last_blurred as Element | undefined, args.direction as FieldDirection, args.steps as number);
    return message === undefined ? done : { ok: false, message };
  });
  host.register_handler("copy.links", (args) => yank_links(args.scope as "page" | "viewport", args.format as LinkFormat));
  host.register_handler("hint.unhover", () => unhover());

  // The command line asks for the list and `report` hands it back, so the answer does not go through the background.
  host.register_handler("heading.list", (args) => void (args.report as (items: HeadingItem[]) => void)(take_snapshot().rows));
  host.register_handler("heading.go", (args) => go_to_heading(String(args.heading)));
  host.register_handler("heading.clear", () => clear_snapshot());

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
    if (candidates.length === 0) return { ok: false, message: none_message(text) };
    // Pending until the user picks a label or leaves hint mode.
    return new Promise<Outcome>((finish) => {
      // A caret start ends hint mode on the first pick, so rapid has nothing to repeat.
      const current: Session = { cancelled: false, args, finish, action, waiting_tokens: [], rapid: args.rapid === true && !starts_caret(action), filter, with_background: filter === "images", custom_selector, text, lower_text: text?.toLowerCase() };
      session = current;
      host.set_mode("hint");
      void build(current, candidates, true);
    });
  });
}

// A second run would register a second copy and orphan the first copy's labels.
if (!page.desertfox_hints_ready) {
  page.desertfox_hints_ready = true;
  register(page.desertfox_host);
}
