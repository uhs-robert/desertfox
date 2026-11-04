// Loads bundles on first use and holds what they register. A bundle is a script the background injects
// into this frame. It registers through `register_sink` and `register_handler` and enters its mode with `set_mode`.
// main.ts puts all three on `window.oasisfox_host`. The host counts every wait on a load, and key_flow holds keys until none is left.

import { BUNDLE_FOR_MODE } from "../shared/bundles.ts";
import type { BundleName } from "../shared/bundles.ts";
import type { Mode } from "../shared/command.ts";
import type { Outcome } from "../shared/messages.ts";

// Where a sink's mode went. A mode, or "page_hidden" when the tab or page went away while the mode was active.
export type ExitDestination = Mode | "page_hidden";

// Gets each key token while its mode is active. "pass" hands the token on to the keymap.
// `enter` runs once per entry, after the sink is registered. `exit` runs once per exit, whichever path led out.
export type Sink = { on_token: (token: string) => "handled" | "pass"; enter?: () => void; exit: (destination: ExitDestination) => void };

// What a handler returns: nothing for done, or an Outcome. A promise stays pending while the handler waits on the user. A throw is failed.
export type HandlerResult = void | Outcome | Promise<void | Outcome>;
export type BundleHandler = (args: Record<string, unknown>) => HandlerResult;

// What a bundle sees of the host.
export type BundleHostApi = {
  register_sink: (mode: Mode, sink: Sink) => void;
  register_handler: (command_id: string, handler: BundleHandler) => void;
  // Any mode, the same path as a key that changes mode. A bundle uses it to enter its own mode.
  set_mode: (mode: Mode) => void;
  get_mode: () => Mode;
  // Runs a handler of another bundle, loading that bundle first if needed. The id need not be a registry command: a bundle may offer handlers only its sibling calls. The args are bundle-internal and unchecked by the validator, and may hold functions.
  // The answer is the handler's real outcome, and stays pending while the handler waits on the user. A missing handler or a failed load answers failed.
  run_command: (command_id: string, name: BundleName, args: Record<string, unknown>) => Promise<Outcome>;
  show_toast: (message: string) => void;
};

export type BundleHostDeps = {
  // Never rejects: a failure answers false.
  request_bundle: (name: BundleName) => Promise<boolean>;
  // Runs after a load and everything that waited on it is done, so held keys can replay.
  on_idle: () => void;
  show_error: (message: string) => void;
  // Without it a bundle's toast goes to show_error.
  show_toast?: (message: string) => void;
  set_mode: (mode: Mode) => void;
  // A mode with a sink ended its load without one, so nothing would take its keys.
  on_sink_missing: (mode: Mode) => void;
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
  let current_mode: Mode = "normal";

  // A second call joins the first load. A failed load is forgotten, so the next call tries again.
  // Keys stay held until `after` has run, because `after` may change the mode they replay in.
  // `hold` false is for work that does not decide how keys replay, such as drawing, so keys do not wait for it.
  function after_load(name: BundleName, after: (loaded: boolean) => void, hold = true): void {
    let started = loads.get(name);
    if (!started) {
      started = deps.request_bundle(name);
      loads.set(name, started);
      void started.then((loaded) => loaded || loads.delete(name));
    }
    if (hold) waiting++;
    void started.then((loaded) => {
      try {
        after(loaded);
      } catch (error) {
        deps.show_error((error as Error).message);
      }
      if (hold) waiting--;
      deps.on_idle();
    });
  }

  // Runs a command whose code sits in a bundle, loading the bundle first if needed. `missing` is the failure for a bundle that registers nothing.
  // Keys are held for the load only, never while the handler's promise is pending.
  // `args` reaches the handler as given. Nothing validates it, so it holds whatever the caller and the handler agree on, functions included. Take it only from bundle code, never from keymap or command-line input, which the registry validates first.
  // `hold` false is for drawing, which nobody awaits, so a failure there goes to `show_error`.
  function run_command(command_id: string, name: BundleName, args: Record<string, unknown>, missing: string, hold = true): Promise<Outcome> {
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
                  if (!registered) throw new Error(loaded ? missing : `OasisFox could not load ${name}`);
                  return registered(args);
                }),
              ),
            hold,
          ),
        );
    if (!hold) void answer.then((outcome) => outcome.ok || deps.show_error(outcome.message));
    return answer;
  }

  return {
    connect: (next: BundleHostDeps) => {
      deps = next;
    },
    is_loading: () => waiting > 0,
    sink_of: (mode: Mode) => sinks.get(mode),
    has_handler: (command_id: string) => handlers.has(command_id),
    run_command,
    // Called on every mode change: the mode left exits its sink, and a mode with a sink loads its bundle and enters it.
    enter_mode: (next: Mode): void => {
      const left = current_mode;
      current_mode = next;
      sinks.get(left)?.exit(next);
      const name = BUNDLE_FOR_MODE[next];
      if (!name) return;
      const enter = () => {
        if (current_mode !== next) return;
        const sink = sinks.get(next);
        if (sink) sink.enter?.();
        else deps.on_sink_missing(next);
      };
      if (sinks.has(next)) enter();
      else after_load(name, enter);
    },
    // The tab or page went away. A mode with a sink ends and the page returns to normal mode.
    page_hidden: (): void => {
      const sink = sinks.get(current_mode);
      if (!sink) return;
      current_mode = "normal";
      sink.exit("page_hidden");
      deps.set_mode("normal");
    },
    // What a bundle sees.
    api: {
      register_sink: (mode, sink) => void sinks.set(mode, sink),
      register_handler: (command_id, handler) => void handlers.set(command_id, handler),
      set_mode: (mode) => deps.set_mode(mode),
      get_mode: () => current_mode,
      run_command: (command_id, name, args) => run_command(command_id, name, args, `${name} has no ${command_id}`),
      show_toast: (message) => (deps.show_toast ?? deps.show_error)(message),
    } satisfies BundleHostApi,
  };
}

export type BundleHost = ReturnType<typeof create_bundle_host>;
