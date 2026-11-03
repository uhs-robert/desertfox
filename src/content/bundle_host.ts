// Loads bundles on first use and holds what they register. A bundle is a script the background injects
// into this frame. It registers through `register_sink` and `register_handler`, which main.ts puts on
// `window.oasisfox_host`. The host counts every wait on a load, and key_flow holds keys until none is left.

import { BUNDLE_FOR_MODE } from "../shared/bundles.ts";
import type { BundleName } from "../shared/bundles.ts";
import type { Mode } from "../shared/command.ts";

// Gets each key token while its mode is active. "pass" hands the token on to the keymap.
export type Sink = { on_token: (token: string) => "handled" | "pass"; exit: () => void };

export type BundleHandler = (args: Record<string, unknown>) => void;

// What a bundle sees of the host.
export type BundleHostApi = {
  register_sink: (mode: Mode, sink: Sink) => void;
  register_handler: (command_id: string, handler: BundleHandler) => void;
};

export type BundleHostDeps = {
  // Never rejects: a failure answers false.
  request_bundle: (name: BundleName) => Promise<boolean>;
  // Runs after a load and everything that waited on it is done, so held keys can replay.
  on_idle: () => void;
  show_error: (message: string) => void;
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
    // Called on every mode change: the mode left drops its sink, and a mode with a sink loads its bundle.
    enter_mode: (next: Mode): void => {
      const left = current_mode;
      current_mode = next;
      sinks.get(left)?.exit();
      const name = BUNDLE_FOR_MODE[next];
      if (name && !sinks.has(next)) after_load(name, () => current_mode === next && !sinks.has(next) && deps.on_sink_missing(next));
    },
    // What a bundle sees.
    api: {
      register_sink: (mode, sink) => void sinks.set(mode, sink),
      register_handler: (command_id, handler) => void handlers.set(command_id, handler),
    } satisfies BundleHostApi,
  };
}

export type BundleHost = ReturnType<typeof create_bundle_host>;
