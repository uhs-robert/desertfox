// Loads bundles on first use and holds what they register. A bundle is a script the background injects
// into this frame. It registers through `register_sink` and `register_handler` and enters its mode with `set_mode`.
// main.ts puts all three on `window.oasisfox_host`. The host counts every wait on a load, and key_flow holds keys until none is left.

import { BUNDLE_FOR_MODE } from "../shared/bundles.ts";
import type { BundleName } from "../shared/bundles.ts";
import type { Mode } from "../shared/command.ts";

// Where a sink's mode went. A mode, or "page_hidden" when the tab or page went away while the mode was active.
export type ExitDestination = Mode | "page_hidden";

// Gets each key token while its mode is active. "pass" hands the token on to the keymap.
// `enter` runs once per entry, after the sink is registered. `exit` runs once per exit, whichever path led out.
export type Sink = { on_token: (token: string) => "handled" | "pass"; enter?: () => void; exit: (destination: ExitDestination) => void };

export type BundleHandler = (args: Record<string, unknown>) => void;

// What a bundle sees of the host.
export type BundleHostApi = {
  register_sink: (mode: Mode, sink: Sink) => void;
  register_handler: (command_id: string, handler: BundleHandler) => void;
  // Any mode, the same path as a key that changes mode. A bundle uses it to enter its own mode.
  set_mode: (mode: Mode) => void;
  get_mode: () => Mode;
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

  return {
    connect: (next: BundleHostDeps) => {
      deps = next;
    },
    is_loading: () => waiting > 0,
    sink_of: (mode: Mode) => sinks.get(mode),
    has_handler: (command_id: string) => handlers.has(command_id),
    // Runs a command whose code sits in a bundle, loading the bundle first if needed. `missing` is the refusal for a bundle that registers nothing.
    run_command: (command_id: string, name: BundleName, args: Record<string, unknown>, missing: string, hold = true): void => {
      const run = handlers.get(command_id);
      if (run) return run(args);
      after_load(name, (loaded) => {
        const registered = handlers.get(command_id);
        if (!registered) throw new Error(loaded ? missing : `OasisFox could not load ${name}`);
        registered(args);
      }, hold);
    },
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
      show_toast: (message) => (deps.show_toast ?? deps.show_error)(message),
    } satisfies BundleHostApi,
  };
}

export type BundleHost = ReturnType<typeof create_bundle_host>;
