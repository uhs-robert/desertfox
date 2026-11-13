// Loads bundles on first use and holds what they register. A bundle is a script the background injects
// into this frame. It registers through `register_sink_` and `register_handler_` and enters its mode with `set_mode_`.
// main.ts puts all three on `window.desertfox_host`. The host counts every wait on a load, and key_flow holds keys until none is left.

import { last_blurred_element } from "./handlers/page.ts";
import { end_flight, scroll_target } from "./handlers/scroll.ts";
import { BUNDLE_FOR_MODE } from "../shared/bundles.ts";
import type { BundleName } from "../shared/bundles.ts";
import { is_caret_mode } from "../shared/command.ts";
import type { Mode } from "../shared/command.ts";
import type { Outcome } from "../shared/messages.ts";
import { refused_as } from "../shared/swallow.ts";

// Where a sink's mode went. A mode, or "page_hidden" when the tab or page went away while the mode was active.
export type ExitDestination = Mode | "page_hidden";

// Gets each key token while its mode is active. "pass" hands the token on to the keymap.
// `enter` runs once per entry, after the sink is registered. `exit` runs once per exit, whichever path led out.
export type Sink = { on_token_: (token: string, physical?: string | null) => "handled" | "pass"; live_?: () => boolean; enter?: () => void; exit: (destination: ExitDestination) => void };

// What a handler returns: nothing for done, or an Outcome. A promise stays pending while the handler waits on the user. A throw is failed.
export type HandlerResult = void | Outcome | Promise<void | Outcome>;
export type BundleHandler = (args: Record<string, unknown>) => HandlerResult;

// What a bundle sees of the host.
export type BundleHostApi = {
  register_sink_: (mode: Mode, sink: Sink) => void;
  register_handler_: (command_id: string, handler: BundleHandler) => void;
  // Any mode, the same path as a key that changes mode. A bundle uses it to enter its own mode.
  set_mode_: (mode: Mode) => void;
  get_mode: () => Mode;
  // Leaves hint or command line mode for the mode it was opened from, and any other mode for normal.
  escape_: () => void;
  // Runs a handler of another bundle, loading that bundle first if needed. The id need not be a registry command: a bundle may offer handlers only its sibling calls. The args are bundle-internal and unchecked by the validator, and may hold functions.
  // The answer is the handler's real outcome, and stays pending while the handler waits on the user. A missing handler or a failed load answers failed.
  run_command_: (command_id: string, name: BundleName, args: Record<string, unknown>) => Promise<Outcome>;
  show_toast_: (message: string) => void;
  // The field the last Escape left, which a bundle cannot see.
  last_blurred_: () => Element | undefined;
  // The box the vertical scroll keys move now. Ends a smooth scroll in flight first, because the flight state lives in content.js and a copy in a bundle could not cancel it.
  scroll_box_: () => Element;
  // Holds the keys that can bind until `handed_back` settles, then replays its keys ahead of them. The command line hands back this way the keys its frame got after the line ended.
  // `drop_on_hide` ends the hold, with no keys handed back, when the page goes away, so a reply lost to the page cache cannot leave the keys held.
  hold_keys_until_: (handed_back: Promise<readonly string[]>, drop_on_hide?: boolean) => void;
};

// What main.ts adds to the host a bundle sees: the frame's own answer to `is_editable_element`, which holds the per-site rules. A bundle's copy of editable.ts has none.
export type PageHostApi = BundleHostApi & { is_editable_: (element: Element | null) => boolean };

export type BundleHostDeps = {
  // Never rejects: a failure answers false.
  request_bundle_: (name: BundleName) => Promise<boolean>;
  // Runs after a load and everything that waited on it is done, so held keys can replay.
  on_idle_: () => void;
  // Puts keys typed in another document ahead of the held ones, for the next `on_idle_` to replay.
  hold_first_: (tokens: readonly string[]) => void;
  show_error_: (message: string) => void;
  // Without it a bundle's toast goes to show_error_.
  show_toast_?: (message: string) => void;
  set_mode_: (mode: Mode) => void;
  // The frame's own Escape: hint and command line mode return to where they began. Content passes it, a test host may not.
  escape_?: () => void;
};

export const message_of = (error: unknown) => String((error as Error)?.message ?? error);

// Answers the outcome of a call: nothing is done, a throw is failed. Calls the handler on the spot, so a sync handler still runs in the caller's turn.
export function settle(call: () => HandlerResult): Promise<Outcome> {
  return new Promise<HandlerResult>((resolve) => resolve(call())).then(
    (result) => (result as Outcome | undefined) ?? { ok: true },
    (error: unknown): Outcome => ({ ok: false, message: message_of(error) }),
  );
}

export function create_bundle_host() {
  const sinks = new Map<Mode, Sink>();
  const handlers = new Map<string, BundleHandler>();
  const loads = new Map<BundleName, Promise<boolean>>();
  // A bundle registers its handlers as its script runs, a little before its load answers. Calls queued on the load run when it answers, so until then a new call queues behind them.
  const unanswered = new Set<BundleName>();
  let deps: BundleHostDeps;
  let waiting = 0;
  const waiting_on_sink_bundle = new Map<BundleName, number>();
  let current_mode: Mode = "normal";
  // The holds that `page_hidden_` ends: a lost reply must not leave the keys held after the page returns from the page cache.
  const ending_on_hide = new Set<(tokens: readonly string[]) => void>();

  // A second call joins the first load. A failed load is forgotten, so the next call tries again.
  // Keys stay held until `after` has run, because `after` may change the mode they replay in.
  // `hold` false is for work that does not decide how keys replay, such as drawing, so keys do not wait for it.
  function after_load(name: BundleName, after: (loaded: boolean) => void, hold = true): void {
    let started = loads.get(name);
    if (!started) {
      started = deps.request_bundle_(name);
      loads.set(name, started);
      unanswered.add(name);
      // Registered ahead of every `after`, so the calls queued on the load run before a new call can take the fast path.
      void started.then((loaded) => (unanswered.delete(name), loaded || loads.delete(name)));
    }
    const sink_bundle = hold && Object.values(BUNDLE_FOR_MODE).includes(name);
    if (hold) waiting++;
    if (sink_bundle) waiting_on_sink_bundle.set(name, (waiting_on_sink_bundle.get(name) ?? 0) + 1);
    void started.then((loaded) => {
      try {
        after(loaded);
      } catch (error) {
        deps.show_error_((error as Error).message);
      }
      if (hold) waiting--;
      if (sink_bundle) waiting_on_sink_bundle.set(name, waiting_on_sink_bundle.get(name)! - 1);
      deps.on_idle_();
    });
  }

  // Runs a command whose code sits in a bundle, loading the bundle first if needed. `missing` is the failure for a bundle that registers nothing.
  // This call holds keys for the load only, never while the handler's promise is pending. A captured-key leaf holds them itself, through `hold_keys_until_`.
  // `args` reaches the handler as given. Nothing validates it, so it holds whatever the caller and the handler agree on, functions included. Take it only from bundle code, never from keymap or command-line input, which the registry validates first.
  // `hold` false is for drawing, which nobody awaits, so a failure there goes to `show_error_`.
  function run_command_(command_id: string, name: BundleName, args: Record<string, unknown>, missing: string, hold = true): Promise<Outcome> {
    const run = !unanswered.has(name) && handlers.get(command_id);
    const answer = run
      ? settle(() => run(args))
      : new Promise<Outcome>((resolve) =>
          after_load(
            name,
            (loaded) =>
              resolve(
                settle(() => {
                  const registered = handlers.get(command_id);
                  if (!registered) throw new Error(loaded ? missing : `DesertFox could not load ${name}`);
                  return registered(args);
                }),
              ),
            hold,
          ),
        );
    if (!hold) void answer.then((outcome) => outcome.ok || deps.show_error_(outcome.message));
    return answer;
  }

  // Runs a mode change now, or after caret.js has loaded if it is loading: a caret mode set meanwhile waits on that load, and a later change must not overtake it. A load for a caret command such as a search holds the changes too, for a few ms at most.
  // Keys need no such wait, because key_flow holds them while a sink bundle loads.
  function in_mode_order_(change: () => void): void {
    if (unanswered.has("caret")) after_load("caret", change);
    else change();
  }

  // A caret mode is set by the caret bundle's `caret.mode`, after its sink is in, as hint and cmdline mode are set by their own bundles. Its sink then sees enter and exit in the order of the changes, however slowly caret.js loads.
  // Only a caret mode that waits on caret.js answers a promise, failed when caret.js does not load or registers no `caret.mode`.
  const set_mode_ = (mode: Mode): void | Promise<Outcome> =>
    is_caret_mode(mode) && !sinks.has(mode) ? run_command_("caret.mode", "caret", { mode }, "needs caret mode") : in_mode_order_(() => deps.set_mode_(mode));

  return {
    connect: (next: BundleHostDeps) => {
      deps = next;
    },
    // A new key in a hint pick skips the captured-key holds, because a macro replay holds keys while its pick waits for its labels. Held keys still wait, so none drains into the pick.
    is_loading_: (taking?: boolean) => waiting > (taking && current_mode == "hint" ? ending_on_hide.size : 0),
    // The bundles loading now that register a sink, so their mode may take keys once the load is done.
    loading_sink_bundles_: (): BundleName[] => [...waiting_on_sink_bundle].filter(([, count]) => count > 0).map(([name]) => name),
    sink_of_: (mode: Mode) => sinks.get(mode),
    has_handler_: (command_id: string) => handlers.has(command_id),
    run_command_,
    set_mode_,
    in_mode_order_,
    // Called on every mode change: the mode left exits its sink and the mode entered enters its own. `set_mode_` sets a mode with a sink only once its sink is in.
    enter_mode_: (next: Mode): void => {
      const left = current_mode;
      current_mode = next;
      sinks.get(left)?.exit(next);
      sinks.get(next)?.enter?.();
    },
    // The tab or page went away. A mode with a sink ends and the page returns to normal mode.
    page_hidden_: (): void => {
      for (const release of [...ending_on_hide]) release([]);
      const sink = sinks.get(current_mode);
      if (!sink) return;
      current_mode = "normal";
      sink.exit("page_hidden");
      deps.set_mode_("normal");
    },
    // What a bundle sees.
    api: {
      register_sink_: (mode, sink) => void sinks.set(mode, sink),
      register_handler_: (command_id, handler) => void handlers.set(command_id, handler),
      set_mode_: (mode) => void set_mode_(mode),
      get_mode: () => current_mode,
      escape_: () => in_mode_order_(() => deps.escape_?.()),
      run_command_: (command_id, name, args) => run_command_(command_id, name, args, `${name} has no ${command_id}`),
      show_toast_: (message) => (deps.show_toast_ ?? deps.show_error_)(message),
      last_blurred_: last_blurred_element,
      scroll_box_: () => (end_flight(), scroll_target("y")),
      hold_keys_until_: (handed_back, drop_on_hide?: boolean) => {
        waiting++;
        const release = (tokens: readonly string[]) => {
          // A hold ends once, by its reply or by the page going away, whichever comes first.
          if (!ending_on_hide.delete(release) && drop_on_hide) return;
          deps.hold_first_(tokens);
          waiting--;
          deps.on_idle_();
        };
        if (drop_on_hide) ending_on_hide.add(release);
        void refused_as(handed_back, []).then(release);
      },
    } satisfies BundleHostApi,
  };
}

export type BundleHost = ReturnType<typeof create_bundle_host>;
