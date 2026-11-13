// The `grab` bundle: drags an element from the keys. `grab.mode` takes a hint pick, the way `caret.mode` does: the hints bundle leaves the element in `desertfox_pick_target` and passes the action as `mode`. `hint --grab` asks the hints bundle for a second pick, the target, and drives the drag to it. `hint --grab_move` holds the element and enters grab mode, whose keys (`grab.move`, `grab.drop`, `grab.cancel`) move, drop and cancel it.

import type { BundleHostApi } from "../bundle_host.ts";
import type { Outcome } from "../../shared/messages.ts";
import { abort, center_of, drive, nudge, press, release, scale_step } from "./drag.ts";
import type { Direction, Held } from "./drag.ts";

type GrabWindow = { desertfox_host?: BundleHostApi; desertfox_grab_ready?: true; desertfox_pick_target?: Element };
const grab = window as unknown as GrabWindow;

const refused = (message: string): Outcome => ({ ok: false, message });
const ran: Outcome = { ok: true };
const REFUSED = refused("The page refused the drag");
const NOTHING_HELD = refused("Nothing is grabbed");

// The page's reaction cannot be read, so the words say what ran and nothing about what it did.
const DROPPED_TOAST = "Grab dropped";
const KEYS_TOAST = "Grab: h j k l move, [ ] step, Enter drops, Escape cancels";

function register(host: BundleHostApi): void {
  // The element held in grab mode.
  let held: Held | undefined;
  // The first pick of `hint --grab`, until its target is picked or the second hint is left.
  let source: Element | undefined;
  // The drag of a `hint --grab` in flight.
  let driving: Held | undefined;

  // The one way a drag ends early: the sink's `exit` calls it for Escape, a second command, a page that goes hidden, and the keys call `escape_` to reach it. `abort` ends it at once, so nothing it sends is late.
  function end_all(): void {
    const stopping = [held, driving];
    held = driving = source = undefined;
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
    const dragged = press(from);
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
      held = press(element);
      if (!held) return REFUSED;
      host.set_mode_("grab");
      host.show_toast_(KEYS_TOAST);
      return ran;
    }
    source = element;
    return pick_target();
  });

  host.register_handler_("grab.move", (args): Outcome => {
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
    if (!held) return NOTHING_HELD;
    const dropped = held;
    held = undefined;
    release(dropped);
    host.show_toast_(DROPPED_TOAST);
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
