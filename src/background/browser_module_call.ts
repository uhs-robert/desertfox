// One call from the extension to the browser module and its answer. `send` writes the request and returns its id. The module's reply comes back later through `hear`. Every command the extension starts on the module goes through `call`.
import type { ModuleArgs, ModuleReply, ModuleStatus } from "../shared/browser_module_protocol.ts";
import { refused_as } from "../shared/swallow.ts";
import { BROWSER_MODULE_STATUS_STORAGE_KEY, EXTENSION_TO_MODULE_KINDS } from "../shared/browser_module_protocol.ts";

export const NEEDS_MODULE = "Needs the browser module";
export const MODULE_ANSWER_MS = 2000;

export type CallResult = { ok: true } | { ok: false; error: string };

export type ModuleCallDeps = {
  send: (kind: string, args: ModuleArgs, on_id?: (id: string) => void) => Promise<{ ok: true; id: string } | { ok: false; problem: string }>;
  // Takes a request back out of the module's list.
  withdraw: (id: string) => Promise<void>;
  // What the hello check last found. Only a matched module can answer.
  read_status: () => Promise<ModuleStatus | undefined>;
  // Runs `run` once after `ms`. The returned function cancels it.
  later: (run: () => void, ms: number) => () => void;
};

export function create_module_call(deps: ModuleCallDeps) {
  const waiting = new Map<string, (result: CallResult) => void>();

  // An entry settles once: it leaves the map first, so a second reply, a late one or a clear finds nothing.
  const settle = (id: string, result: CallResult, withdraw = false): void => {
    const done = waiting.get(id);
    waiting.delete(id);
    // A call the module never answered must not run later, after the user saw it refused.
    if (done && withdraw) void refused_as(deps.withdraw(id), undefined);
    done?.(result);
  };

  return {
    hear(reply: ModuleReply): void {
      settle(reply.reply_to, reply.ok ? { ok: true } : { ok: false, error: reply.error ?? "The browser module refused" });
    },
    // The module is gone or off: every call still waiting ends with NEEDS_MODULE.
    clear(): void {
      for (const id of [...waiting.keys()]) settle(id, { ok: false, error: NEEDS_MODULE }, true);
    },
    // Hears each change of the status key. Anything but a matched module ends the waiting calls.
    status_changed(status: ModuleStatus | undefined): void {
      if (status?.result !== "matched") this.clear();
    },
    async call(kind: string, args: ModuleArgs = {}): Promise<CallResult> {
      if (EXTENSION_TO_MODULE_KINDS[kind]?.reply === false) return { ok: false, error: `${kind} is a push and never gets a reply` };
      if ((await deps.read_status())?.result !== "matched") return { ok: false, error: NEEDS_MODULE };
      return new Promise<CallResult>((resolve) => {
        let id: string | undefined;
        // The wait is registered before the request is written, so a reply that comes at once finds it.
        const on_id = (made: string): void => {
          id = made;
          const cancel = deps.later(() => settle(made, { ok: false, error: NEEDS_MODULE }, true), MODULE_ANSWER_MS);
          waiting.set(made, (result) => {
            cancel();
            resolve(result);
          });
        };
        void refused_as(deps.send(kind, args, on_id), undefined).then((sent) => {
          if (sent?.ok) return;
          const failed = { ok: false, error: NEEDS_MODULE } as const;
          if (id === undefined) resolve(failed);
          else settle(id, failed, true);
        });
      });
    },
  };
}

export type ModuleCall = ReturnType<typeof create_module_call>;

// The background builds the module channel once, and the commands reach it through this handle. Until `attach_browser_module` runs, a call finds no module.
let channel_send: ModuleCallDeps["send"] = async () => ({ ok: false, problem: NEEDS_MODULE });
let channel_withdraw: ModuleCallDeps["withdraw"] = async () => undefined;

export function attach_browser_module(channel: Pick<ModuleCallDeps, "send" | "withdraw">): void {
  channel_send = channel.send;
  channel_withdraw = channel.withdraw;
}

export const browser_module_call = create_module_call({
  send: (kind, args, on_id) => channel_send(kind, args, on_id),
  withdraw: (id) => channel_withdraw(id),
  read_status: async () => (await browser.storage.session.get(BROWSER_MODULE_STATUS_STORAGE_KEY))[BROWSER_MODULE_STATUS_STORAGE_KEY] as ModuleStatus | undefined,
  later: (run, ms) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
});
