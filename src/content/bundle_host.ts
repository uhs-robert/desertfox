// Loads bundles on first use and holds what they register. A bundle is a script the background injects
// into this frame. It registers through `register_sink_` and `register_handler_` and enters its mode with `set_mode_`.
// main.ts puts all three on `window.desertfox_host`. The host counts every wait on a load, and key_flow holds keys until none is left.

import { last_blurred_element } from "./handlers/page.ts";
import { BUNDLE_FOR_MODE } from "../shared/bundles.ts";
import type { BundleName } from "../shared/bundles.ts";
import type { Mode } from "../shared/command.ts";
import type { Outcome } from "../shared/messages.ts";

// Where a sink's mode went. A mode, or "page_hidden" when the tab or page went away while the mode was active.
export type ExitDestination = Mode | "page_hidden";

// Gets each key token while its mode is active. "pass" hands the token on to the keymap.
// `enter` runs once per entry, after the sink is registered. `exit` runs once per exit, whichever path led out.
export type Sink = { on_token_: (token: string) => "handled" | "pass"; enter?: () => void; exit: (destination: ExitDestination) => void };

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
  // Runs a handler of another bundle, loading that bundle first if needed. The id need not be a registry command: a bundle may offer handlers only its sibling calls. The args are bundle-internal and unchecked by the validator, and may hold functions.
  // The answer is the handler's real outcome, and stays pending while the handler waits on the user. A missing handler or a failed load answers failed.
  run_command_: (command_id: string, name: BundleName, args: Record<string, unknown>) => Promise<Outcome>;
  show_toast_: (message: string) => void;
  // The field the last Escape left, which a bundle cannot see.
  last_blurred_: () => Element | undefined;
  // Holds the keys that can bind until `handed_back` settles, then replays its keys ahead of them. The command line hands back this way the keys its frame got after the line ended.
  hold_keys_until_: (handed_back: Promise<readonly string[]>) => void;
};

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
  // A mode with a sink ended its load without one, so nothing would take its keys.
  on_sink_missing_: (mode: Mode) => void;
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
  let deps: BundleHostDeps;
  let waiting = 0;
  const waiting_on_sink_bundle = new Map<BundleName, number>();
  let current_mode: Mode = "normal";

  // A second call joins the first load. A failed load is forgotten, so the next call tries again.
  // Keys stay held until `after` has run, because `after` may change the mode they replay in.
  // `hold` false is for work that does not decide how keys replay, such as drawing, so keys do not wait for it.
  function after_load(name: BundleName, after: (loaded: boolean) => void, hold = true): void {
    let started = loads.get(name);
    if (!started) {
      started = deps.request_bundle_(name);
      loads.set(name, started);
      void started.then((loaded) => loaded || loads.delete(name));
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
  // Keys are held for the load only, never while the handler's promise is pending.
  // `args` reaches the handler as given. Nothing validates it, so it holds whatever the caller and the handler agree on, functions included. Take it only from bundle code, never from keymap or command-line input, which the registry validates first.
  // `hold` false is for drawing, which nobody awaits, so a failure there goes to `show_error_`.
  function run_command_(command_id: string, name: BundleName, args: Record<string, unknown>, missing: string, hold = true): Promise<Outcome> {
    const run = handlers.get(command_id);
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

  return {
    connect: (next: BundleHostDeps) => {
      deps = next;
    },
    is_loading_: () => waiting > 0,
    // The bundles loading now that register a sink, so their mode may take keys once the load is done.
    loading_sink_bundles_: (): BundleName[] => [...waiting_on_sink_bundle].filter(([, count]) => count > 0).map(([name]) => name),
    sink_of_: (mode: Mode) => sinks.get(mode),
    has_handler_: (command_id: string) => handlers.has(command_id),
    run_command_,
    // Called on every mode change: the mode left exits its sink, and a mode with a sink loads its bundle and enters it.
    enter_mode_: (next: Mode): void => {
      const left = current_mode;
      current_mode = next;
      sinks.get(left)?.exit(next);
      const name = BUNDLE_FOR_MODE[next];
      if (!name) return;
      const enter = () => {
        if (current_mode !== next) return;
        const sink = sinks.get(next);
        if (sink) sink.enter?.();
        else deps.on_sink_missing_(next);
      };
      if (sinks.has(next)) enter();
      else after_load(name, enter);
    },
    // The tab or page went away. A mode with a sink ends and the page returns to normal mode.
    page_hidden_: (): void => {
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
      set_mode_: (mode) => deps.set_mode_(mode),
      get_mode: () => current_mode,
      run_command_: (command_id, name, args) => run_command_(command_id, name, args, `${name} has no ${command_id}`),
      show_toast_: (message) => (deps.show_toast_ ?? deps.show_error_)(message),
      last_blurred_: last_blurred_element,
      hold_keys_until_: (handed_back) => {
        waiting++;
        void handed_back.catch(() => []).then((tokens) => {
          deps.hold_first_(tokens);
          waiting--;
          deps.on_idle_();
        });
      },
    } satisfies BundleHostApi,
  };
}

export type BundleHost = ReturnType<typeof create_bundle_host>;
