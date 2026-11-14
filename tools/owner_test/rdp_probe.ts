import net from "node:net";
import { join } from "node:path";
import { Refusal } from "./refusal.ts";
import { keep_chain } from "../../src/shared/swallow.ts";
import { judge_probe } from "./probe.ts";

const EXTENSION_ID = "desertfox@uhs-robert";
const RDP_MODULE = join(import.meta.dirname, "..", "..", "test", "key", "rdp.mjs");

type Rdp = { request: (to: string, message: object) => Promise<any>; close: () => void };

// connect_rdp opens its socket at once and gives no handle to it, and it bounds only the greeting, not a TCP connect that never completes. So the socket is caught as it is made, and destroyed on expiry, which lets the process exit.
function connect_catching_socket(connect_rdp: (port: number, options: object) => Promise<Rdp>, port: number, request_timeout_ms: number): { connecting: Promise<Rdp>; sockets: net.Socket[] } {
  const sockets: net.Socket[] = [];
  const original = net.connect;
  (net as { connect: unknown }).connect = (...args: unknown[]) => {
    const socket = (original as (...rest: unknown[]) => net.Socket)(...args);
    sockets.push(socket);
    return socket;
  };
  try {
    // net.connect runs synchronously inside this call, so the patch is back before any other code can see it.
    return { connecting: connect_rdp(port, { request_timeout_ms }), sockets };
  } finally {
    (net as { connect: unknown }).connect = original;
  }
}

// Every step of one debugger session shares one deadline. On timeout the connection is closed, so a debugger that accepts but never answers, or never accepts, fails in time and leaves no socket behind. Every failure is a Refusal: one line for the user.
async function with_rdp<T>(port: number, deadline_ms: number, run: (rdp: Rdp) => Promise<T>): Promise<T> {
  const { connect_rdp } = await import(RDP_MODULE);
  const { connecting, sockets } = connect_catching_socket(connect_rdp, port, deadline_ms);
  let rdp: Rdp | undefined;
  let expired = false;
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      rdp?.close();
      sockets.forEach((socket) => socket.destroy());
      reject(new Refusal(`the debugger did not answer within ${deadline_ms} ms`));
    }, deadline_ms);
  });
  const work = (async () => {
    rdp = await connecting;
    if (expired) rdp?.close();
    return run(rdp as Rdp);
  })();
  // The race may be lost first. The work's own rejection then has no reader, and the race reports the deadline instead.
  void keep_chain(work);
  try {
    return await Promise.race([work, deadline]);
  } catch (error) {
    throw error instanceof Refusal ? error : new Refusal(`debugger: ${(error as Error).message}`);
  } finally {
    clearTimeout(timer);
    rdp?.close();
    sockets.forEach((socket) => socket.destroy());
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
    if (!addon) throw new Refusal("the add-on is not loaded in the test window");
    await rdp.request(addon.actor, { type: "reload" });
  });
}
