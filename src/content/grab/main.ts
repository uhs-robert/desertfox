// The `grab` bundle: drags an element from the keys. `grab.mode` takes a hint pick, the way `caret.mode` does: the hints bundle leaves the element in `desertfox_pick_target` and passes the action as `mode`. `hint --grab` asks the hints bundle for a second pick, the target, and drives the drag to it. `hint --grab_move` holds the element and enters grab mode, whose keys (`grab.move`, `grab.drop`, `grab.cancel`) move, drop and cancel it.

import type { PageHostApi } from "../bundle_host.ts";
import type { Outcome } from "../../shared/messages.ts";
import { abort, center_of, drive, FLING_SETTLE_MS, FLING_STEPS, nudge, press, release, scale_step, snap_scroll, start_fling } from "./drag.ts";
import type { Direction, Held } from "./drag.ts";

type GrabWindow = { desertfox_host?: PageHostApi; desertfox_grab_ready?: true; desertfox_pick_target?: Element };
const grab = window as unknown as GrabWindow;

const refused = (message: string): Outcome => ({ ok: false, message });
const ran: Outcome = { ok: true };
const REFUSED = refused("The page refused the drag");
const NOTHING_HELD = refused("Nothing is grabbed");

// The page's reaction cannot be read, so the words say what ran and nothing about what it did.
const DROPPED_TOAST = "Grab dropped";
const KEYS_TOAST = "Grab: h j k l move, [ ] step, Enter drops, Escape cancels";

function register(host: PageHostApi): void {
  // The element held in grab mode.
  let held: Held | undefined;
  // The first pick of `hint --grab`, until its target is picked or the second hint is left.
  let source: Element | undefined;
  // The drag of a `hint --grab` in flight, or the latest fling of a swipe, which `abort` ignores once it has ended.
  let driving: Held | undefined;
  // The element a swipe mode flings. Swipe shares grab mode with the grab keys, so this is what tells `h j k l` to fling.
  let swiping: Element | undefined;

  // The one way a drag ends early: the sink's `exit` calls it for Escape, a second command, a page that goes hidden, and the keys call `escape_` to reach it. `abort` ends it at once, so nothing it sends is late.
  function end_all(): void {
    const stopping = [held, driving];
    held = driving = source = swiping = undefined;
    queue = [];
    for (const drag of stopping) if (drag) abort(drag);
  }

  // A `;g` drive runs in normal mode, which has no sink, so Escape and a page that goes away stop it from these two listeners.
  function stop_drive_on(event: Event): void {
    if (event.type === "pagehide" || (event as KeyboardEvent).key === "Escape") end_all();
  }

  async function drop_on(target: Element): Promise<Outcome> {
    const from = source!;
    source = undefined;
    if (from.ownerDocument !== target.ownerDocument) return refused("Grab works inside one frame");
    const dragged = press(from, host.grab_step_px_());
    if (!dragged) return REFUSED;
    driving = dragged;
    const stoppers = ["keydown", "pagehide"];
    for (const type of stoppers) window.addEventListener(type, stop_drive_on, true);
    try {
      await drive(dragged, center_of(target));
    } finally {
      for (const type of stoppers) window.removeEventListener(type, stop_drive_on, true);
    }
    if (driving !== dragged) return { ok: true, cancelled: true };
    driving = undefined;
    host.show_toast_(DROPPED_TOAST);
    return ran;
  }

  // Any element can take a drop, so the target hint is not narrowed by the filter of the first.
  const TARGET_HINT_ARGS = { action: "grab", filter: "every", frames: "same_origin", rapid: false, nested_: true };

  async function pick_target(): Promise<Outcome> {
    // The second hint answers once the target is picked and dropped on, or when the hint ends without one.
    const outcome = await host.run_command_("hint.run", "hints", TARGET_HINT_ARGS);
    source = undefined;
    return outcome;
  }

  host.register_handler_("grab.mode", (args): Outcome | Promise<Outcome> => {
    const element = grab.desertfox_pick_target;
    delete grab.desertfox_pick_target;
    if (!element) return refused("Nothing to grab");
    if (source) return drop_on(element);
    end_all();
    if (args.mode === "grab_move") {
      held = press(element, host.grab_step_px_());
      if (!held) return REFUSED;
      host.set_mode_("grab");
      host.show_toast_(KEYS_TOAST);
      return ran;
    }
    if (args.mode === "grab_swipe") {
      swiping = element;
      host.set_mode_("grab");
      host.show_toast_("Swipe: h j k l");
      return ran;
    }
    source = element;
    return pick_target();
  });

  // The flings of fast keys run one after another, so each finishes before the next presses. `end_all` swaps in a new queue, and a fling that waits in the old one sees that and never starts. A key past the cap of two waiting flings is dropped, so a held key moves at most two more slides after key-up.
  const MAX_WAITING_FLINGS = 2;
  // One entry per fling that has not started.
  let queue: true[] = [];
  let last_fling: Promise<Outcome> = Promise.resolve(ran);
  function swipe(target: Element, direction: Direction): Outcome | Promise<Outcome> {
    const mine = queue;
    if (mine.length >= MAX_WAITING_FLINGS) return ran;
    mine.push(true);
    const turn = async (): Promise<Outcome> => {
      mine.pop();
      if (queue !== mine || snap_scroll(target, direction)) return ran;
      const { held: flung, to, pause_ms } = start_fling(target, direction);
      driving = flung;
      await drive(flung, to, FLING_STEPS, pause_ms, FLING_SETTLE_MS);
      return ran;
    };
    // A fling that threw must not leave the queue rejected for every later one.
    return (last_fling = last_fling.then(turn, turn));
  }

  host.register_handler_("grab.move", (args): Outcome | Promise<Outcome> => {
    if (swiping) return swipe(swiping, args.direction as Direction);
    if (!held) return NOTHING_HELD;
    nudge(held, args.direction as Direction);
    return ran;
  });

  host.register_handler_("grab.step", (args): Outcome => {
    if (!held) return NOTHING_HELD;
    const step = scale_step(held, args.scale === "finer" ? 0.5 : 2);
    host.show_toast_(step === undefined ? "A range input keeps its own step" : `Grab step ${step} px`);
    return ran;
  });

  host.register_handler_("grab.drop", (): Outcome => {
    if (!held && !swiping) return NOTHING_HELD;
    if (held) {
      release(held);
      held = undefined;
      host.show_toast_(DROPPED_TOAST);
    }
    host.escape_();
    return ran;
  });

  host.register_handler_("grab.cancel", (): Outcome => {
    host.escape_();
    return ran;
  });

  // Tokens go on to the keymap. The sink is here for `exit`, which every way out of the mode reaches: a second command, a navigation that hides the page, Escape.
  host.register_sink_("grab", { on_token_: () => "pass", exit: end_all });
}

// A second run would register the handlers again for nothing. With no host, content.js has not started here, and the load it asks for later registers them.
const host = grab.desertfox_host;
if (!grab.desertfox_grab_ready && host) {
  grab.desertfox_grab_ready = true;
  register(host);
}
