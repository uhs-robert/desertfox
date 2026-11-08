// A small client for Firefox's remote debugging protocol: install a temporary add-on and run code in its background page.
import net from "node:net";

export async function connect_rdp(port) {
  const socket = net.connect(port, "127.0.0.1");
  let buffer = "";
  const inbox = [];
  const waiting = [];
  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    for (;;) {
      const colon = buffer.indexOf(":");
      if (colon < 0) return;
      const length = Number(buffer.slice(0, colon));
      if (Buffer.byteLength(buffer.slice(colon + 1)) < length) return;
      const body = Buffer.from(buffer.slice(colon + 1)).subarray(0, length).toString();
      buffer = buffer.slice(colon + 1 + body.length);
      inbox.push(JSON.parse(body));
      for (const wake of waiting.splice(0)) wake();
    }
  });
  const next_from = async (actor, matches = () => true, timeout_ms = 10000) => {
    const deadline = Date.now() + timeout_ms;
    for (;;) {
      const index = inbox.findIndex((message) => message.from === actor && matches(message));
      if (index >= 0) return inbox.splice(index, 1)[0];
      if (Date.now() > deadline) throw new Error(`rdp: no answer from ${actor}`);
      await new Promise((resolve) => { waiting.push(resolve); setTimeout(resolve, 200); });
    }
  };
  const request = async (to, message, matches) => {
    const text = JSON.stringify({ to, ...message });
    socket.write(`${Buffer.byteLength(text)}:${text}`);
    return next_from(to, matches ?? ((reply) => reply.type === undefined || reply.type === message.type || "error" in reply));
  };
  await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  await next_from("root");
  // The polling pauses of this client go through here, so the timings can charge them to the debugger.
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  return { request, next_from, pause, close: () => socket.destroy() };
}

export async function install_temporary_addon(rdp, addon_path) {
  const { addonsActor } = await rdp.request("root", { type: "getRoot" });
  const reply = await rdp.request(addonsActor, { type: "installTemporaryAddon", addonPath: addon_path });
  if (!reply.addon) throw new Error(`rdp: install failed: ${JSON.stringify(reply)}`);
  return reply.addon;
}

// Console actor per connection and add-on.
const console_actors = new Map();

async function attach_console(rdp, addon_id) {
  const { addons } = await rdp.request("root", { type: "listAddons" });
  const addon = addons.find((entry) => entry.id === addon_id);
  if (!addon) throw new Error(`rdp: add-on ${addon_id} is not listed`);
  const watcher = await rdp.request(addon.actor, { type: "getWatcher", isServerTargetSwitchingEnabled: false });
  await rdp.request(watcher.actor, { type: "watchTargets", targetType: "frame" }, (reply) => reply.type === undefined);
  const background_form = (await drain_to_newest_background_form(rdp, watcher.actor)) ?? (await rdp.next_from(watcher.actor, is_background_target_form));
  return background_form.target.consoleActor;
}

// The watcher sends a target form for every extension frame, newtab and home tabs too, and nobody reads them while an actor lives.
// The old forms point at closed tabs, where an evaluate waits out its whole timeout. Only the newest live background form counts.
async function drain_to_newest_background_form(rdp, watcher_actor) {
  const live_background_forms = [];
  for (;;) {
    let event;
    try {
      // A zero timeout reads only what is already queued.
      event = await rdp.next_from(watcher_actor, is_target_event, 0);
    } catch {
      return live_background_forms.at(-1);
    }
    if (event.type === "target-destroyed-form") {
      const destroyed_at = live_background_forms.findIndex((form) => form.target.actor === event.target?.actor);
      if (destroyed_at >= 0) live_background_forms.splice(destroyed_at, 1);
    } else if (is_background_target_form(event)) {
      live_background_forms.push(event);
    }
  }
}

const is_target_event = (reply) => reply.type === "target-destroyed-form" || is_console_target_form(reply);
const is_console_target_form = (reply) => reply.type === "target-available-form" && reply.target?.consoleActor !== undefined;
const is_background_target_form = (reply) => is_console_target_form(reply) && reply.target.url?.endsWith("/_generated_background_page.html");

// Runs async code in the add-on's background page and returns its JSON result.
// Firefox sends the console actor once per watcher, so later calls reuse the first one. A reload kills it, so a dead actor is dropped and attached again.
export async function evaluate_in_background(rdp, addon_id, async_code) {
  if (!console_actors.has(rdp)) console_actors.set(rdp, new Map());
  const actors = console_actors.get(rdp);
  for (let attempt = 0; ; attempt++) {
    const console_actor = actors.get(addon_id) ?? (await attach_console(rdp, addon_id));
    actors.set(addon_id, console_actor);
    try {
      const value = await run_in_console(rdp, console_actor, async_code);
      if (value?.error?.includes("is not defined") && attempt === 0) throw new Error("dead global");
      return value;
    } catch (error) {
      actors.delete(addon_id);
      if (attempt >= 1) throw error;
    }
  }
}

// Runs async code in Firefox's parent process, with chrome privileges.
export async function evaluate_in_chrome(rdp, async_code) {
  const { processDescriptor } = await rdp.request("root", { type: "getProcess", id: 0 });
  const { process } = await rdp.request(processDescriptor.actor, { type: "getTarget" });
  return run_in_console(rdp, process.consoleActor, async_code);
}

// The result of a background evaluation is usually ready within a few milliseconds, so the first polls come fast and the later ones slow down.
const RESULT_POLL_STEPS_MS = [0, 5, 10, 20, 50];
const RESULT_POLL_STEP_MAX_MS = 100;
const RESULT_TIMEOUT_MS = 5000;

async function run_in_console(rdp, console_actor, async_code) {
  const slot = `__key_test_${Math.random().toString(36).slice(2)}`;
  const start = `globalThis.${slot} = undefined; (async () => ${async_code})().then((value) => { globalThis.${slot} = JSON.stringify(value ?? null); }, (error) => { globalThis.${slot} = JSON.stringify({ error: String(error) }); }); "started"`;
  await evaluate(rdp, console_actor, start);
  const deadline = Date.now() + RESULT_TIMEOUT_MS;
  for (let attempt = 0; Date.now() < deadline; attempt++) {
    const value = await evaluate(rdp, console_actor, `globalThis.${slot}`);
    if (typeof value === "string") return JSON.parse(value);
    await rdp.pause(RESULT_POLL_STEPS_MS[attempt] ?? RESULT_POLL_STEP_MAX_MS);
  }
  throw new Error("rdp: background code did not finish");
}

// Content processes by pid, per connection. A pid is never reused within a run, so a dead process is never asked for.
const process_consoles = new Map();

async function console_of_process(rdp, pid) {
  if (!process_consoles.has(rdp)) process_consoles.set(rdp, new Map());
  const consoles = process_consoles.get(rdp);
  if (!consoles.has(pid)) {
    const { processes } = await rdp.request("root", { type: "listProcesses" });
    const descriptor = processes.find((entry) => entry.id === pid);
    if (!descriptor) throw new Error(`rdp: process ${pid} is not listed`);
    const { process } = await rdp.request(descriptor.actor, { type: "getTarget" });
    consoles.set(pid, process.consoleActor);
  }
  return consoles.get(pid);
}

// Reads a frame of the selected tab whose address ends with `/${frame_path}`, such as the command line, an extension page in an iframe of a web page.
// The add-on's own watcher never lists such a frame, and neither does `getViews`. So the parent process finds the frames' browsing contexts,
// and the content process that holds each one runs `frame_code`, a function source taking the frame's window. Returns one value per frame.
export async function evaluate_in_page_frames(rdp, frame_path, frame_code) {
  const frames = await evaluate_in_chrome(rdp, `(async () => {
    const found = [];
    const walk = (context) => {
      const global = context.currentWindowGlobal;
      if (global?.documentURI?.spec.split(/[?#]/)[0].endsWith(${JSON.stringify(`/${frame_path}`)})) found.push({ context_id: context.id, pid: global.domProcess.osPid });
      for (const child of context.children) walk(child);
    };
    walk(Services.wm.getMostRecentWindow("navigator:browser").gBrowser.selectedBrowser.browsingContext);
    return found;
  })()`);
  if (!Array.isArray(frames)) throw new Error(`rdp: listing the frames failed: ${JSON.stringify(frames)}`);
  const values = [];
  for (const { context_id, pid } of frames) {
    const console_actor = await console_of_process(rdp, pid);
    // The module's global is a chrome global, which has BrowsingContext. The console's own global has not.
    const value = await run_in_console(rdp, console_actor, `(async () => {
      const chrome_global = Components.utils.getGlobalForObject(ChromeUtils.importESModule("resource://gre/modules/ExtensionPageChild.sys.mjs"));
      const frame_window = chrome_global.BrowsingContext.get(${context_id})?.window;
      return frame_window ? (${frame_code})(frame_window) : null;
    })()`);
    if (value?.error) throw new Error(`rdp: reading the ${frame_path} frame failed: ${value.error}`);
    if (value !== null) values.push(value);
  }
  return values;
}

async function evaluate(rdp, console_actor, text) {
  const ack = await rdp.request(console_actor, { type: "evaluateJSAsync", text }, (reply) => "resultID" in reply);
  const result = await rdp.next_from(console_actor, (reply) => reply.type === "evaluationResult" && reply.resultID === ack.resultID);
  if (result.exception) throw new Error(`rdp: evaluation threw: ${JSON.stringify(result.exceptionMessage ?? result.exception)}`);
  return result.result;
}
