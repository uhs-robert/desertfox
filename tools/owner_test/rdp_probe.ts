import { join } from "node:path";
import { keep_chain } from "../../src/shared/swallow.ts";
import { judge_probe } from "./probe.ts";

const EXTENSION_ID = "desertfox@uhs-robert";
const RDP_MODULE = join(import.meta.dirname, "..", "..", "test", "key", "rdp.mjs");

type Rdp = { request: (to: string, message: object) => Promise<any>; close: () => void };

// Every step of one debugger session shares one deadline. On timeout the connection is closed, so a debugger that accepts but never answers fails in time and leaves no socket behind.
async function with_rdp<T>(port: number, deadline_ms: number, run: (rdp: Rdp) => Promise<T>): Promise<T> {
  const { connect_rdp } = await import(RDP_MODULE);
  let rdp: Rdp | undefined;
  let expired = false;
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      rdp?.close();
      reject(new Error(`the debugger did not answer within ${deadline_ms} ms`));
    }, deadline_ms);
  });
  const work = (async () => {
    rdp = await connect_rdp(port, { request_timeout_ms: deadline_ms });
    if (expired) rdp?.close();
    return run(rdp as Rdp);
  })();
  // The race may be lost first. The work's own rejection then has no reader, and the race reports the deadline instead.
  void keep_chain(work);
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    rdp?.close();
  }
}

export type ProbeOutcome = { ok: boolean; message: string; permissions: string };

export function probe_window(port: number, expected_stamp: string, deadline_ms: number): Promise<ProbeOutcome> {
  return with_rdp(port, deadline_ms, async (rdp) => {
    const { evaluate_in_background } = await import(RDP_MODULE);
    const { addons } = await rdp.request("root", { type: "listAddons" });
    const addon = addons.find((entry: { id: string }) => entry.id === EXTENSION_ID);
    let loaded_stamp: string | null = null;
    let permissions = "";
    if (addon?.temporarilyInstalled === true) {
      const info = await evaluate_in_background(rdp, EXTENSION_ID, "browser.permissions.getAll().then((granted) => ({ version_name: browser.runtime.getManifest().version_name ?? null, granted }))");
      loaded_stamp = info.version_name;
      permissions = JSON.stringify(info.granted);
    }
    const verdict = judge_probe({ addon, loaded_stamp, expected_stamp });
    return { ok: verdict.ok, message: verdict.ok ? "ok" : verdict.message, permissions };
  });
}

// The same call web-ext's own watcher makes: the add-on reloads from its source folder, in the same window and profile.
export function reload_window(port: number, deadline_ms: number): Promise<void> {
  return with_rdp(port, deadline_ms, async (rdp) => {
    const { addons } = await rdp.request("root", { type: "listAddons" });
    const addon = addons.find((entry: { id: string }) => entry.id === EXTENSION_ID);
    if (!addon) throw new Error("the add-on is not loaded in the test window");
    await rdp.request(addon.actor, { type: "reload" });
  });
}
