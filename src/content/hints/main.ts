// The `hints` bundle: registers the hint sink and the `hint.run` handler with the host.
// `hint.run` enters hint mode at once, finds and labels the visible elements, then waits for a label to be typed.

import type { HintFramesMessage } from "../../background/hint_frames.ts";
import type { HintFramesPick, HintFramesPickAnswer, HintFramesReport, HintFramesStart, HintFramesStartAnswer, HintFramesTyped, Outcome } from "../../shared/messages.ts";
import { CONFIG_STATUS_STORAGE_KEY } from "../../background/storage_keys.ts";
import type { PageHostApi } from "../bundle_host.ts";
import { unhover } from "./hover.ts";
import { has_usable_address, is_inside_link, is_media, OPEN_PLACES, perform, starts_mode, takes_typing } from "./actions.ts";
import type { ModeAction, HintAction, Place } from "./actions.ts";
import { hand_to_devtools } from "./inspect.ts";
import { prompt_pick } from "./prompt_line.ts";
import { collect_pick } from "./collect_copy.ts";
import { copy_yank } from "../caret/copy_text.ts";
import { collect, drop_off_screen, keep_text_matches, text_of, keep_visible_deduplicated, query_for, scroll_clips_in_page, weak_test_for, window_of, with_site_selectors } from "./candidates.ts";
import type { Found, HintFilter, SiteSelectors } from "./candidates.ts";
import { clean_letters, make_labels, narrow } from "./labels.ts";
import { create_picker, is_text_key } from "./pick.ts";
import type { KeyOutcome } from "./pick.ts";
import { is_hint_char } from "./hint_keys.ts";
import { insert_into_focused_field } from "./insert_text.ts";
import { mark_text_entry } from "../text/entry.ts";
import { create_view } from "./view.ts";
import type { HintView } from "./view.ts";
import { follow_windows } from "./follow.ts";
import { box_owners, boxes_with_fallback, uncovered_through_frames, viewport_size } from "./visible.ts";
import type { PageProbe } from "./visible.ts";
import { clear_snapshot, go_to_heading, keep_present_found, step_heading, take_snapshot } from "./headings.ts";
import type { HeadingDirection } from "./headings.ts";
import { all_links, yank_links } from "./yank_links.ts";
import type { LinkFormat, YankDeps } from "./yank_links.ts";
import { can_open_elsewhere, find_follow_link } from "./follow_links.ts";
import { focus_field } from "./focus_fields.ts";
import type { FieldDirection } from "./focus_fields.ts";
import type { FollowDirection } from "./follow_links.ts";
import { read_strip_patterns } from "../strip_setting.ts";
import { strip_tracking } from "../strip_tracking.ts";
import { DEFAULT_SETTINGS, DEFAULT_STRIP_TRACKING_PARAMS } from "../../shared/default_settings.ts";
import type { HeadingItem, RecordTiming } from "../../shared/messages.ts";
import { arm_leave_watch } from "../page/leave_watch.ts";
import { best_effort, ignore_refusal } from "../../shared/swallow.ts";

// `desertfox_content_loaded` holds the start of a frame whose content script waits for its first focus, see `../handlers/focus.ts`.
type HintsWindow = { desertfox_host: PageHostApi; desertfox_hints_ready?: true; desertfox_pick_target?: Element; desertfox_content_loaded?: true | (() => void) };
const page = window as unknown as HintsWindow;

const done: Outcome = { ok: true };
const cancelled_outcome: Outcome = { ok: true, cancelled: true };

type Session = {
  cancelled: boolean;
  // Set at the first pick. Only that pick answers `hint.run`, so a later rapid pick that fails shows its own message.
  picked?: true;
  // The hint.run args, which `.` repeats after a pick.
  args: Record<string, unknown>;
  // Settles the promise `hint.run` returned. The first call wins, so each path that leaves hint mode must call it before `set_mode_`, because the mode change ends the session as cancelled.
  finish: (outcome: Outcome | Promise<Outcome>) => void;
  action: HintAction;
  // Keys typed while the elements are still being found.
  waiting_tokens_: string[];
  waiting_physical_: (string | null | undefined)[];
  // Rapid mode picks again after each pick.
  rapid: boolean;
  // `frames=all_frames`: the labels cover every frame of the tab, and this frame owns the keyboard. See `src/background/hint_frames.ts`.
  across_frames_: boolean;
  filter: HintFilter;
  // Only the images filter takes a picture from a CSS background.
  with_background_: boolean;
  custom_selector_: string | undefined;
  site_selectors_: SiteSelectors;
  // The `text` param as typed, and lower-cased for the match. Both are undefined without it.
  text: string | undefined;
  lower_text_: string | undefined;
  // What a rapid copy has picked so far, in order. The clipboard holds all of it after every pick.
  collected_: string[];
  ready?: Labeled & { picker: ReturnType<typeof create_picker>; view: HintView; stop_following_: () => void; relayed_: string };
  // Set while a pick that typed text waits out its grace, see `PICK_GRACE_MS`. Keys that continue the word are dropped.
  settling_?: true;
};

// What one build labels. `labels` holds every label, also those of other frames, in the picker's order. `own_labels` are this frame's, one per element of `found`. `own_of_` turns a label's index into the index of this frame's element, or undefined for another frame's. `session_id_` and `texts_` (the text of every label, also those of other frames) are set across frames only.
type Labeled = { found: Found[]; labels: readonly string[]; own_labels: readonly string[]; own_of_: (index: number) => number | undefined; session_id_?: string; texts_?: string[] };

function single_frame(found: Found[], letters: string[]): Labeled {
  const labels = make_labels(found.length, letters);
  return { found, labels, own_labels: labels, own_of_: (index) => index };
}

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
function find_candidates(filter: HintFilter, custom_selector: string | undefined, action: HintAction, site_selectors: SiteSelectors, only_in_view = true): Found[] {
  const opens_elsewhere = OPEN_PLACES.includes(action);
  const with_background = filter === "images";
  const found = with_site_selectors(document, filter, collect(document, query_for(filter, custom_selector), weak_test_for(filter), only_in_view), site_selectors, only_in_view);
  const outside_links = action === "double_click" ? found.filter((item) => !is_inside_link(item.element)) : found;
  return outside_links.filter((item) => (!opens_elsewhere && !with_background) || has_usable_address(item.element as HTMLElement, with_background, opens_elsewhere));
}

const none_message = (text: string | undefined): string => (text === undefined ? "No hints on this page" : `No link matches ${text}`);

// The collect step: what a person can see of the candidates, narrowed by `text`.
async function shown_of(current: Pick<Session, "filter" | "action" | "lower_text_">, candidates: Found[]): Promise<Found[]> {
  const visible = await keep_visible_ones(candidates, current.filter, current.action === "inspect");
  return current.lower_text_ === undefined ? visible : keep_text_matches(visible, current.lower_text_);
}

async function keep_visible_ones(candidates: Found[], filter: HintFilter, skips_cover_test = false): Promise<Found[]> {
  const own_rects = (element: Element) => Array.from(element.getClientRects());
  const children = (element: Element) => Array.from(element.children);
  const owners = new Map(candidates.map((found) => [found.element, box_owners(found.element, own_rects, children)]));
  const seen = await observe_intersecting([...new Set([...owners.values()].flat())]);
  const probe: PageProbe<Found> = {
    is_intersecting_: (found) => owners.get(found.element)!.some((owner) => seen.has(owner)),
    rects_of_: (found) => boxes_with_fallback(found.element, own_rects, children),
    clips_of_: (found) => scroll_clips_in_page(found.element),
    viewport_of_: (found) => viewport_size(found.element.ownerDocument, window_of(found.element)),
    is_hidden_by_style_: (found) => window_of(found.element).getComputedStyle(found.element).visibility === "hidden",
    // Site players lay click-catching controls over the video, and a card lays a stretched link over its picture, so a cover test would drop them.
    is_reachable_at_: (found, x, y) => uncovered_through_frames(found, x, y, skips_cover_test || filter === "images" || (filter === "media" && is_media(found.element))),
  };
  return keep_visible_deduplicated(candidates, probe);
}

const yank_deps = (register: string | undefined): YankDeps => ({
  find: all_links,
  strip_patterns: () => read_strip_patterns(window.location.href),
  keep_present_: keep_present_found,
  keep_in_view_: (found) => keep_visible_ones(drop_off_screen(found), "links"),
  copy: (text) => copy_yank(navigator.clipboard, text, register),
  show_message_: (message) => create_view().show_message_(message),
});

// Read when the hints are built, because a pick copies without waiting.
let strip_patterns: readonly string[] = DEFAULT_STRIP_TRACKING_PARAMS;

async function read_setting(name: string): Promise<unknown> {
  const stored = await browser.storage.local.get(CONFIG_STATUS_STORAGE_KEY);
  const status = stored[CONFIG_STATUS_STORAGE_KEY] as { settings?: Record<string, unknown> } | undefined;
  return status?.settings?.[name];
}

const parses_as_selector = (selector: string): boolean => {
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
};

// Past this, hints start with no site selectors, so a background that never answers cannot keep the keys held.
const SITE_SELECTORS_WAIT_MS = 2000;

// Asked at every `hint.run`, so a settings edit or a new address applies from the next run on. A rapid session keeps what its run read.
// A selector that does not parse drops out with one notice for the run, and the rest still apply.
async function read_site_selectors(show_toast: (message: string) => void): Promise<SiteSelectors> {
  const asked = ignore_refusal(browser.runtime.sendMessage({ type: "read_hint_selectors" }));
  const reply = (await Promise.race([asked, new Promise((resolve) => setTimeout(resolve, SITE_SELECTORS_WAIT_MS))])) as { hint_add?: string[]; hint_remove?: string[] } | undefined;
  const bad: string[] = [];
  const parsed = (selectors: string[] | undefined) => (selectors ?? []).filter((selector) => parses_as_selector(selector) || (bad.push(selector), false));
  const site_selectors = { add: parsed(reply?.hint_add), remove: parsed(reply?.hint_remove) };
  if (bad.length > 0) show_toast(`Skipped hint selectors that do not parse: ${bad.join(", ")}`);
  return site_selectors;
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
    else await open_link_(element.href, place);
    return done;
  }
  const result = await perform(place, element, deps);
  return result && typeof result === "object" && "ok" in result ? (result as Outcome) : done;
}

// A refused copy answers failed and shows nothing here: the pick's answer carries it to the caller, which shows it once.
function copy_to_clipboard(text: string, register: string | undefined, what?: string): Promise<Outcome | undefined> {
  return copy_yank(navigator.clipboard, text, register).then((copied) => {
    if (!copied.ok) return copied;
    if ("dropped" in copied) return;
    // A view of its own, so the notice does not wipe the labels that rapid mode shows.
    create_view().show_message_(`Copied ${what ?? (text.length > 40 ? text.slice(0, 40) + "..." : text)}`);
  });
}

// The background answers an `Outcome`. A failed one carries the refusal to the caller, which shows it once.
function image_action(action: "copy_image" | "download", address: string): Promise<Outcome> {
  return browser.runtime.sendMessage({ type: "image_action", action, address }).then((outcome: Outcome | undefined) => {
    if (!outcome) return { ok: false, message: "The picture action got no answer" };
    if (outcome.ok) create_view().show_message_(action === "copy_image" ? "Copied image" : "Started the download");
    return outcome;
  });
}

// `from_hints` keeps the router from storing this `open.url`, so `.` shows hints again instead of reopening the address.
function open_link_(url: string, place: Place): Promise<unknown> {
  return browser.runtime.sendMessage({ type: "run", invocations: [{ id: "open.url", args: { url, where: place } }], mode: "normal", from_hints: true });
}

// A pick that starts a mode of another bundle: the caret bundle (caret, visual) or the grab bundle. The bundle reads the element in `desertfox_pick_target` when its `<bundle>.mode` handler runs, and loads on that first entry. A failed load fails the pick.
function start_mode_(target: Element, mode: ModeAction): Promise<Outcome> {
  page.desertfox_pick_target = target;
  const bundle = mode[0] === "g" ? "grab" : "caret";
  return page.desertfox_host.run_command_(`${bundle}.mode`, bundle, { mode });
}

const inspect_ = (target: Element): Promise<Outcome> => hand_to_devtools(window as never, target, () => browser.runtime.sendMessage({ type: "inspect_pick" }), setTimeout, (message) => create_view().show_message_(message));

// A pick copies into the register its own `hint.run` was typed with.
const COLLECT_NOUNS = { copy: ["address", "addresses"], copy_text: ["text", "texts"] } as const;

// A rapid copy rewrites the whole list on every pick, so the clipboard is right at any Escape and after a navigation.
function copy_of_pick(current: Pick<Session, "args" | "action" | "rapid" | "collected_">) {
  const register = current.args.register as string | undefined;
  const nouns = current.rapid && (current.action === "copy" || current.action === "copy_text") ? COLLECT_NOUNS[current.action] : undefined;
  return (text: string, what?: string) => {
    const list = nouns && collect_pick(current.collected_, text, nouns);
    return copy_to_clipboard(list ? list.text : text, register, list ? list.what : what);
  };
}

const pick_deps = (current: Pick<Session, "args" | "action" | "rapid" | "collected_">) => ({ ...deps, copy: copy_of_pick(current) });

// The line opens in this frame, as it does for a key typed here. Keys typed while cmdline.js loads stay held for it.
const open_line_ = (text: string): Promise<Outcome> => page.desertfox_host.run_command_("cmdline.open", "cmdline", { text });

type PickArgs = Pick<Session, "args" | "action" | "rapid" | "collected_" | "with_background_">;

// `hand_over` is for a pick another frame owns: the text that would be copied, or the line that would open, goes to the keyboard frame instead.
type HandOver = (text: string, what?: string) => void;

// Set while a pick performs, so the address change the pick makes (a table-of-contents anchor) does not end the session that made it.
let picking = false;

const perform_pick = (current: PickArgs, element: HTMLElement, hand_over?: HandOver) => {
  if (current.action === "prompt") return prompt_pick(element, current.args.command as string, current.with_background_, hand_over ? (text) => (hand_over(text), Promise.resolve(done)) : open_line_);
  // A pick right after a jump is the user's own move, so the address change it makes records.
  arm_leave_watch(page.desertfox_host).quiet_(false);
  picking = true;
  let result;
  try {
    result = perform(current.action, element, hand_over ? { ...deps, copy: hand_over } : pick_deps(current), current.with_background_);
  } finally {
    picking = false;
  }
  // The hint mode has ended, so the frame is in the mode the hint began in. A refused pick leaves it there.
  if (current.action === "enter_media" && !result) page.desertfox_host.set_mode_("media");
  return result;
};

// The background answers within its 500 ms wait. Past this, it is gone or stuck, and the frame keeps its own labels.
const ACROSS_START_WAIT_MS = 2000;

// Across frames every frame runs the bundle, and a parent that can read a frame (same origin, about:blank) already labels it with its own walk. Such a frame labels nothing itself, so no element gets two labels. A frame of another site reads null here.
const parent_labels_me = (): boolean => window.frameElement !== null;

const texts_of = (found: Found[]): string[] => found.map((item) => text_of(item.element));

// While this frame starts hints across frames, it ignores the collect: the start carries its count.
let starting = 0;

// To the background, which passes it on. Nothing waits for the answer.
const send_across = (message: Exclude<HintFramesMessage, { type: "hint_frames_collect" | "hint_frames_labels" }>) => void best_effort(browser.runtime.sendMessage(message));

const deps = { open_link_, copy: (text: string, what?: string) => copy_to_clipboard(text, undefined, what), strip_: (address: string) => strip_tracking(address, strip_patterns), image_action, start_mode_, inspect_ };

function register(host: PageHostApi): void {
  let session: Session | undefined;
  // Also reports where the page stood when a hint follow leaves it, which may have no `page` bundle. A same-document change the page makes ends hint mode as Escape does, so hints opened from media mode return to it.
  arm_leave_watch(host).listen_(() => session && !picking && host.escape_());
  // The picks of other frames' hovers, by session id, until Escape releases them. Each release waits for its pick's answer and names its pick, so a late one cannot clear a newer hover.
  let hovers_across: { session_id: string; answered: Promise<unknown> }[] = [];
  // The ids an end reached while this frame waited for its start answer. The end can overtake the answer, which would then show hint mode on a dead session. Cleared when no start waits.
  const ended_ids = new Set<string>();

  function end_session(): void {
    const session_id = session?.ready?.session_id_;
    if (session_id) send_across({ type: "hint_frames_end", session_id });
    session?.ready?.stop_following_();
    session?.ready?.view.clear_labels_();
    if (session) session.cancelled = true;
    session?.finish(cancelled_outcome);
    session = undefined;
  }

  // A pick records what `.` repeats at its start, not at the end of the leaf, because a pick that opens the link in this tab can end the page first. Escape or a failed filter stores nothing. The wait ends when the returned function gets the
  // action's result, so a later step sees the opened tab or the copied text. Call it before `set_mode_`, which ends the session as cancelled.
  function begin_pick(current: Session): (run: () => unknown) => void {
    let answer!: (outcome: Outcome) => void;
    const first = !current.picked;
    current.picked = true;
    current.finish(new Promise<Outcome>((resolve) => (answer = resolve)));
    // The grab bundle runs the target hint inside the first pick, and the first pick is the step to repeat.
    if (!current.args.nested_) void browser.runtime.sendMessage({ type: "record_step", invocations: [{ id: "hint.run", args: current.args }], outcome: done, pick: true });
    const ended = (result: unknown) => {
      let outcome = (result as Outcome | undefined) ?? done;
      // A refused open comes back as a RunResponse with no message. The background already showed it, so it only stops the sequence.
      if (!outcome.ok && typeof outcome.message !== "string") outcome = { ok: true, cancelled: true };
      if (first) answer(outcome);
      else if (!outcome.ok) create_view().show_message_(outcome.message);
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

  // Keys typed while the build ran never reached a mode. They run in normal mode, in order, once the mode change has ended the session.
  // `after_leaving` runs the pick. A pick that focuses a field gets the keys as text, which a replay in insert mode would drop.
  // Insert mode after the pick means the pick focused the field: Escape leaves insert mode without a blur, so a field focused earlier is not a target.
  // For a pick of another frame, `left` is what that frame did not type, and the keys replay once it answers.
  function leave_with_keys(current: Session, after_leaving?: () => void, owner_left?: Promise<string[]>): void {
    const keys = current.waiting_tokens_.splice(0);
    host.escape_();
    after_leaving?.();
    if (owner_left) {
      void owner_left.then((rest) => rest.length > 0 && host.hold_keys_until_(Promise.resolve(rest)));
      return;
    }
    const focused_a_field = after_leaving && host.get_mode() === "insert";
    if (focused_a_field) mark_text_entry({ id: "hint.run", args: current.args });
    const left = focused_a_field ? insert_into_focused_field(keys) : keys;
    if (left.length > 0) host.hold_keys_until_(Promise.resolve(left));
  }

  // Hands this frame's count to the background and waits for the labels of every frame. A background that does not answer leaves this frame's own labels.
  async function label_across(current: Session, found: Found[], letters: string[]): Promise<Labeled | undefined> {
    starting++;
    let answer: HintFramesStartAnswer | undefined;
    try {
      const asked = ignore_refusal(browser.runtime.sendMessage({ type: "hint_frames_start", letters: letters.join(""), args: current.args, count: found.length, texts: texts_of(found) } satisfies HintFramesStart));
      answer = (await Promise.race([asked, new Promise((resolve) => setTimeout(resolve, ACROSS_START_WAIT_MS))])) as HintFramesStartAnswer | undefined;
      // A late answer drew labels in the other frames, which this frame no longer picks from.
      if (!answer) void asked.then((late: HintFramesStartAnswer | undefined) => late?.ok && send_across({ type: "hint_frames_end", session_id: late.session_id }));
    } finally {
      starting--;
    }
    // An end answer means another frame started a run, so this frame's own labels would overlap its labels.
    const ended = answer?.ok && ended_ids.has(answer.session_id);
    if (starting === 0) ended_ids.clear();
    if (answer && (!answer.ok || ended)) return undefined;
    if (!answer) return single_frame(found, letters);
    if (current.cancelled) send_across({ type: "hint_frames_end", session_id: answer.session_id });
    const first_own = answer.labels.indexOf(answer.own_labels[0]!);
    const own_of_ = (index: number) => (index >= first_own && index < first_own + answer.own_labels.length ? index - first_own : undefined);
    return { found, labels: answer.labels, own_labels: answer.own_labels, own_of_, session_id_: answer.session_id, texts_: answer.texts };
  }

  // A pick of another frame's label goes out before hint mode ends here, so the background routes it before the end. The owner's answer is the pick's.
  // The keys typed ahead go with it, for the owner to type into the field it focuses. A mode that starts there drops them.
  // `leaves` is whether the pick ends hint mode here, which hands its keys over. A rapid pick keeps them for its next build.
  function pick_run(current: Session, labeled: Labeled, index: number, leaves: boolean): { run: () => unknown; left?: Promise<string[]> } {
    const own = labeled.own_of_(index);
    if (own !== undefined) return { run: () => perform_pick(current, labeled.found[own]!.element as HTMLElement) };
    const keys = !leaves || current.waiting_tokens_.length === 0 ? undefined : [...current.waiting_tokens_];
    const answer: Promise<HintFramesPickAnswer | undefined> = browser.runtime.sendMessage({ type: "hint_frames_pick", session_id: labeled.session_id_!, label: labeled.labels[index]!, ...(keys && { keys }) } satisfies HintFramesPick);
    if (current.action === "hover") hovers_across.push({ session_id: labeled.session_id_!, answered: best_effort(answer) });
    // A mode that started in the owner takes no typeahead. A mode that failed to start leaves the keys for a replay here.
    const left = ignore_refusal(answer).then((reply) => (reply?.ok === true && starts_mode(current.action) ? [] : reply?.left ?? keys ?? []));
    return { run: () => answer.then((reply) => (reply && "text" in reply ? (current.action === "prompt" ? open_line_(reply.text) : copy_of_pick(current)(reply.text, reply.what)) : reply)), left };
  }

  // Finds, labels and shows the hints. Keys typed meanwhile wait and replay. Rapid mode calls it again after each pick.
  // `started_ms` is taken before the candidates are found, so the time covers finding, filtering and labeling.
  async function build(current: Session, candidates: Found[], first_build: boolean, started_ms: number): Promise<void> {
    const [letters, key_line_setting, shown, patterns] = await Promise.all([read_letters(), read_setting("hint_key_line"), shown_of(current, candidates), read_strip_patterns(window.location.href)]);
    if (current.cancelled) return;
    strip_patterns = patterns;
    const labeled = current.across_frames_ ? await label_across(current, parent_labels_me() ? [] : shown, letters) : single_frame(shown, letters);
    if (current.cancelled) return;
    if (!labeled) {
      current.finish(cancelled_outcome);
      leave_with_keys(current);
      return;
    }
    const { labels, own_of_, found } = labeled;
    if (labels.length === 0) {
      const message = none_message(current.text);
      current.finish({ ok: false, message });
      leave_with_keys(current);
      // Only a rapid rebuild gets here with its promise already settled, so nobody else shows the message.
      if (!first_build) create_view().show_message_(message);
      return;
    }
    // One match needs no label. Only the first build does this, so rapid mode cannot repeat the same pick.
    if (first_build && current.lower_text_ !== undefined && labels.length === 1) {
      const { run, left } = pick_run(current, labeled, 0, true);
      const performed = begin_pick(current);
      leave_with_keys(current, () => performed(run), left);
      return;
    }
    const view = create_view();
    view.show(found.map((item, own) => ({ found: item, text: labeled.own_labels[own]! })));
    if (key_line_setting !== false) view.add_key_line_();
    // Read when text mode first needs the texts, once for this build. Across frames the background already holds every frame's texts.
    let texts: readonly (string | undefined)[] | undefined;
    const text_of_found_ = () => (texts ??= labeled.texts_ ?? labels.map((_label, index) => text_of(found[own_of_(index)!]!.element)));
    // Every build starts in label mode. `text` only filters the hints, it does not start text mode, so the labels stay typable.
    const picker = create_picker(labels, text_of_found_);
    current.ready = { ...labeled, picker, view, stop_following_: follow_windows(windows_of(found), view.reposition), relayed_: JSON.stringify({ type: "hint_frames_typed", session_id: labeled.session_id_, typed: "" }) };
    void best_effort(browser.runtime.sendMessage({ type: "record_timing", name: "hint.build", ms: performance.now() - started_ms } satisfies RecordTiming));
    // The queue stays on the session while the loop drains it: a pick hands what is left to normal mode, a rapid pick leaves it for the next build.
    while (current.ready && !current.cancelled && current.waiting_tokens_.length > 0) handle_token(current, current.waiting_tokens_.shift()!, current.waiting_physical_.shift());
  }

  // The view holds this frame's labels only. The other frames hear the typed prefix through the background. In text mode they get "/" with the matching labels and the active one, because no label holds "/".
  function show_outcome(ready: NonNullable<Session["ready"]>, outcome: KeyOutcome): void {
    if (outcome.kind !== "handled") return;
    const { own_of_ } = ready;
    ready.view.show_progress_(outcome.typed, new Set(outcome.still_possible_.flatMap((index) => own_of_(index) ?? [])), outcome.text, outcome.active === undefined ? undefined : own_of_(outcome.active));
    if (!ready.session_id_) return;
    const { labels, session_id_ } = ready;
    const text_mode = outcome.text === undefined ? undefined : { matches: outcome.still_possible_.map((index) => labels[index]!), active: labels[outcome.active!] };
    const relay: HintFramesTyped = { type: "hint_frames_typed", session_id: session_id_, typed: text_mode ? "/" : outcome.typed, ...text_mode };
    const key = JSON.stringify(relay);
    if (key !== ready.relayed_) send_across(relay);
    ready.relayed_ = key;
  }

  function pick(current: Session, index: number): void {
    const ready = current.ready!;
    delete current.settling_;
    const { run, left } = pick_run(current, ready, index, !current.rapid);
    const performed = begin_pick(current);
    if (!current.rapid) {
      leave_with_keys(current, () => performed(run), left);
      return;
    }
    // Rapid: the pick may delete or move elements, so drop these labels and label the page again.
    ready.stop_following_();
    ready.view.clear_labels_();
    delete current.ready;
    performed(run);
    if (current.cancelled) return;
    const started_ms = performance.now();
    void build(current, find_candidates(current.filter, current.custom_selector_, current.action, current.site_selectors_), false, started_ms);
  }

  // The rest of a typed word still arrives after the key that made the match unique, and it would run as normal keys or as labels of the next round. So that pick waits, with hint mode still open, and the keys are dropped.
  const PICK_GRACE_MS = 300;

  function handle_token(current: Session, token: string, physical?: string | null): "handled" | "pass" {
    if (current.settling_) return is_hint_char(token) || is_text_key(token) ? "handled" : "pass";
    const ready = current.ready!;
    const outcome = ready.picker.on_token_(token, physical);
    if (outcome.kind === "pass") return "pass";
    if (outcome.kind === "rotate") {
      ready.view.rotate_overlaps_();
      return "handled";
    }
    show_outcome(ready, outcome);
    if (outcome.picked !== undefined) {
      const picked_index = outcome.picked;
      // Enter is a deliberate pick. A letter that left one match is the key that may be followed by more of the word.
      if (outcome.text === undefined || token === "<Enter>") pick(current, picked_index);
      else {
        current.settling_ = true;
        setTimeout(() => !current.cancelled && pick(current, picked_index), PICK_GRACE_MS);
      }
    }
    return "handled";
  }

  host.register_handler_("page.follow", (args) => follow_page_link(args.direction as FollowDirection, args.where as Place));
  host.register_handler_("page.focus_field", (args): Outcome => {
    const message = focus_field(document, host.last_blurred_(), args.direction as FieldDirection, args.steps as number);
    if (message !== undefined) return { ok: false, message };
    mark_text_entry({ id: "page.focus_field", args: { direction: args.direction, steps: args.steps } });
    return done;
  });
  host.register_handler_("page.heading", (args): Outcome => {
    const message = step_heading(args.direction as HeadingDirection, args.steps as number);
    return message === undefined ? done : { ok: false, message };
  });
  host.register_handler_("copy.links", (args) => yank_links(args.scope as "page" | "viewport", args.format as LinkFormat, yank_deps(args.register as string | undefined)));
  host.register_handler_("hint.unhover", () => {
    unhover();
    for (const { session_id, answered } of hovers_across.splice(0)) void answered.then(() => send_across({ type: "hint_frames_unhover", session_id }));
  });
  // The sink takes these keys while a session is open. A key that gets here found no session, so there is nothing to do.
  host.register_handler_("hint.key", () => done);

  // The command line asks for the list and `report` hands it back, so the answer does not go through the background.
  host.register_handler_("heading.list", (args) => void (args.report as (items: HeadingItem[]) => void)(take_snapshot().rows));
  host.register_handler_("heading.go", (args) => go_to_heading(String(args.heading)));
  host.register_handler_("heading.clear", () => clear_snapshot());

  host.register_sink_("hint", {
    on_token_: (token, physical) => {
      if (!session) return "pass";
      if (session.ready) return handle_token(session, token, physical);
      if (!is_hint_char(token) && !is_text_key(token)) return "pass";
      session.waiting_tokens_.push(token);
      session.waiting_physical_.push(physical);
      return "handled";
    },
    exit: end_session,
  });

  // A run that starts while an earlier one still waits for its selectors cancels the earlier one.
  let latest_run = 0;

  // Answers when hint mode is on or the run ended without it. The pick's own answer comes later, through `picked`.
  async function start_hints(args: Record<string, unknown>): Promise<Outcome | { picked: Promise<Outcome> }> {
    const started_ms = performance.now();
    const run = ++latest_run;
    const action = args.action as HintAction;
    const filter = args.filter as HintFilter;
    const custom_selector_ = args.selector as string | undefined;
    const site_selectors_ = await read_site_selectors(host.show_toast_);
    if (run !== latest_run) return cancelled_outcome;
    let candidates: Found[];
    try {
      candidates = find_candidates(filter, custom_selector_, action, site_selectors_);
    } catch {
      return { ok: false, message: `Invalid selector: ${custom_selector_}` };
    }
    // With nothing to label the mode never changes, so keys held during the load run as normal keys. A page with candidates only out of view still flips it, as before the view cut.
    const text = (args.text as string | undefined) || undefined;
    // Across frames the other frames can still have hints, and the build gives the notice when no frame has one.
    if (candidates.length === 0 && args.frames !== "all_frames" && !host.frame_parked_() && find_candidates(filter, custom_selector_, action, site_selectors_, false).length === 0) return { ok: false, message: none_message(text) };
    // Pending until the user picks a label or leaves hint mode.
    const picked = new Promise<Outcome>((finish) => {
      // A caret start ends hint mode on the first pick, so rapid has nothing to repeat.
      const current: Session = { cancelled: false, args, finish, action, waiting_tokens_: [], waiting_physical_: [], rapid: args.rapid === true && !starts_mode(action) && action !== "prompt", across_frames_: args.frames === "all_frames" || host.frame_parked_(), filter, with_background_: filter === "images", custom_selector_, site_selectors_, text, lower_text_: text?.toLowerCase(), collected_: [] };
      session = current;
      host.set_mode_("hint");
      void build(current, candidates, true, started_ms);
    });
    return { picked };
  }

  answer_across((session_id) => {
    if (starting > 0) ended_ids.add(session_id);
    if (session?.ready?.session_id_ === session_id) host.escape_();
  });

  host.register_handler_("hint.run", (args): Promise<Outcome> => {
    end_session();
    const started = start_hints(args);
    // Keys typed while the background answers wait, so they reach hint mode and not normal mode. A page hidden before the answer ends the hold, as the answer is then lost.
    host.hold_keys_until_(started.then(() => []), true);
    return started.then((outcome) => ("picked" in outcome ? outcome.picked : outcome));
  });
}

// Another frame's hints across frames: this frame finds its candidates, reports how many, draws the labels the background hands it, follows the typed prefix and runs the pick it owns. Only the frame that started the session reads keys, so this frame stays in its mode.
type Across = { session_id: string; args: Record<string, unknown>; found?: Found[]; labels?: readonly string[]; typed: string; text_mode?: Pick<HintFramesTyped, "matches" | "active"> | undefined; view?: HintView; stop_following_?: () => void };

function answer_across(end_keyboard_session: (session_id: string) => void): void {
  let across: Across | undefined;
  // The session whose pick hovered here, so only the release that names it lets go.
  let hovered_by: string | undefined;
  const clear = () => {
    across?.stop_following_?.();
    across?.view?.clear_labels_();
    across = undefined;
  };
  const show_typed = (current: Across) => {
    const { labels, text_mode } = current;
    if (!text_mode?.matches) return current.view?.show_progress_(current.typed, new Set(narrow(labels!, current.typed).still_possible_));
    const matching = new Set(text_mode.matches);
    current.view?.show_progress_("", new Set(labels!.flatMap((label, index) => (matching.has(label) ? index : []))), undefined, text_mode.active === undefined ? undefined : labels!.indexOf(text_mode.active));
  };

  async function collect_here(current: Across): Promise<void> {
    const { args } = current;
    const action = args.action as HintAction;
    const filter = args.filter as HintFilter;
    const text = (args.text as string | undefined) || undefined;
    let found: Found[] = [];
    const [site_selectors, patterns] = await Promise.all([read_site_selectors(() => {}), read_strip_patterns(window.location.href)]);
    strip_patterns = patterns;
    // A parent labels its readable child only when it is asked itself, which only `all_frames` does. A lone parked frame labels its own targets.
    if (!parent_labels_me() || current.args.frames !== "all_frames") try {
      const candidates = find_candidates(filter, args.selector as string | undefined, action, site_selectors);
      found = await shown_of({ filter, action, lower_text_: text?.toLowerCase() }, candidates);
    } catch {
      // A selector that does not parse labels nothing here. The keyboard frame shows the notice.
    }
    if (across !== current) return;
    current.found = found;
    void best_effort(browser.runtime.sendMessage({ type: "hint_frames_report", session_id: current.session_id, count: found.length, texts: texts_of(found) } satisfies HintFramesReport));
  }

  // The answer of a pick is the action's outcome, which the keyboard frame shows. A copy or a prompt answers with its text, which the keyboard frame copies or opens.
  function pick_here(current: Across, label: string, keys?: string[]): Promise<HintFramesPickAnswer> {
    const index = current.labels?.indexOf(label) ?? -1;
    const element = current.found?.[index]?.element as HTMLElement | undefined;
    clear();
    if (!element) return Promise.resolve({ ok: false, message: "That hint is gone" });
    const { args } = current;
    const pick_args: PickArgs = { args, action: args.action as HintAction, rapid: false, collected_: [], with_background_: args.filter === "images" };
    let handed: { text: string; what: string | undefined } | undefined;
    const hand_over: HandOver = (text, what) => void (handed = { text, what });
    // The keyboard focus is in another frame. Gecko keeps an element's focus() out of a frame of another site that does not hold it, and the window's focus() brings it in.
    if (pick_args.action === "focus" || starts_mode(pick_args.action) || takes_typing(element)) window.focus();
    // Only a pick that focuses a field takes the keys typed ahead. The keyboard frame replays the rest.
    if (pick_args.action === "hover") hovered_by = current.session_id;
    const types_ahead = keys && (pick_args.action === "here" || pick_args.action === "focus") && takes_typing(element);
    const answered = (answer: HintFramesPickAnswer): HintFramesPickAnswer => {
      if (!keys) return answer;
      if (!types_ahead) return { ...answer, left: keys };
      mark_text_entry({ id: "hint.run", args });
      return { ...answer, left: insert_into_focused_field(keys) };
    };
    return Promise.resolve()
      .then(() => perform_pick(pick_args, element, hand_over))
      .then((result) => answered(handed ? { ok: true, text: handed.text, ...(handed.what !== undefined && { what: handed.what }) } : ((result as Outcome | undefined) ?? done)), (error: unknown) => answered({ ok: false, message: String((error as Error)?.message ?? error) }));
  }

  browser.runtime.onMessage.addListener((raw: unknown) => {
    const message = raw as HintFramesMessage;
    if (message.type === "hint_frames_end") end_keyboard_session(message.session_id);
    if (message.type === "hint_frames_collect") {
      if (starting > 0) return undefined;
      clear();
      across = { session_id: message.session_id, args: message.args, typed: "" };
      void collect_here(across);
      return undefined;
    }
    if (message.type === "hint_frames_unhover") {
      if (hovered_by === message.session_id) (hovered_by = undefined, unhover());
      return undefined;
    }
    const current = across;
    if (!message.type?.startsWith("hint_frames_") || current?.session_id !== message.session_id) return undefined;
    if (message.type === "hint_frames_labels" && current.found) {
      current.labels = message.labels;
      current.view = create_view();
      current.view.show(message.labels.map((text, index) => ({ found: current.found![index]!, text })));
      current.stop_following_ = follow_windows(windows_of(current.found), current.view.reposition);
      show_typed(current);
    } else if (message.type === "hint_frames_typed") {
      // The prefix can arrive before the labels, which then start from it.
      current.typed = message.typed;
      current.text_mode = message.matches && { matches: message.matches, active: message.active };
      if (current.labels) show_typed(current);
    } else if (message.type === "hint_frames_pick") return pick_here(current, message.label, message.keys);
    else if (message.type === "hint_frames_end") clear();
    return undefined;
  });
}

// The background injects the bundle into every frame for hints across frames. A frame the user never entered has not started its content script, so the bundle starts it, which sets the host.
if (typeof page.desertfox_content_loaded === "function") page.desertfox_content_loaded();
// A second run would register a second copy and orphan the first copy's labels. Without a host (no content script at all) the flag stays unset, so a later load still registers.
if (!page.desertfox_hints_ready && page.desertfox_host) {
  page.desertfox_hints_ready = true;
  register(page.desertfox_host);
}
