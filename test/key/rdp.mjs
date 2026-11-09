// A small client for Firefox's remote debugging protocol: install a temporary add-on and run code in its background page.
import net from "node:net";

// Firefox answers the requests to one actor in the order it got them (devtools-server-connection.js, _queueResponse), and it answers each one exactly once, with a result or an `error`.
// So a packet without a `type` is a reply and belongs to the oldest request still waiting on its actor. A packet with a `type` is an event, which has no request.
// Replies are never matched by their shape: a guess about the shape is what once handed a reply to the wrong caller.
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const EVENT_QUEUE_MAX = 200;

export async function connect_rdp(port, { request_timeout_ms = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
  const socket = net.connect(port, "127.0.0.1");
  // Bytes, not text: a character of several bytes can arrive in two chunks, and the length prefix counts bytes.
  let buffer = Buffer.alloc(0);
  // Per actor, the requests still waiting for their reply, oldest first.
  // A request that timed out keeps its place, marked abandoned, so its late reply is dropped here and cannot answer a later request.
  const waiting_requests = new Map();
  const event_queues = new Map();
  const event_readers = new Set();
  const event_subscribers = new Map();
  // Set when the socket closes, so a request to a crashed or exited Firefox fails at once and names the cause, where a hung one waits out its timeout.
  let closed_reason;
  let greeted = false;
  let greeting_arrived;
  let greeting_failed;
  const greeting = new Promise((resolve, reject) => { greeting_arrived = resolve; greeting_failed = reject; });
  // A rejection nobody awaits yet (the close can come before connect_rdp reaches the await) must not crash the run.
  greeting.catch(() => {});
  const close_listeners = new Set();

  const lost_message = (actor) => `rdp: connection to Firefox lost (${closed_reason})${actor ? ` while waiting for ${actor}` : ""}`;
  const fail_everything = () => {
    for (const queue of waiting_requests.values()) for (const entry of queue.splice(0)) entry.fail(new Error(lost_message(entry.actor)));
    for (const read of [...event_readers]) read();
    for (const listener of [...close_listeners]) listener();
    if (!greeted) greeting_failed(new Error(`rdp: connection to Firefox lost before it greeted (${closed_reason})`));
  };
  socket.on("error", (error) => { closed_reason ??= error.message; });
  socket.on("close", () => {
    closed_reason ??= "the debugger closed the connection";
    fail_everything();
  });

  const queue_event = (packet) => {
    const queue = event_queues.get(packet.from) ?? [];
    event_queues.set(packet.from, queue);
    queue.push(packet);
    // Events nobody reads (frame updates and the like) must not pile up for a whole run.
    if (queue.length > EVENT_QUEUE_MAX) queue.shift();
    for (const read of [...event_readers]) read();
  };
  const dispatch = (packet) => {
    const actor = packet.from;
    if (packet.type !== undefined) {
      if (!event_subscribers.get(actor)?.(packet)) queue_event(packet);
      return;
    }
    if (!greeted && actor === "root") {
      greeted = true;
      greeting_arrived();
      return;
    }
    const entry = waiting_requests.get(actor)?.shift();
    if (!entry) {
      console.error(`rdp: a reply from ${actor} has no request waiting: ${JSON.stringify(packet).slice(0, 200)}`);
      return;
    }
    entry.settle(packet);
  };
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const colon = buffer.indexOf(":");
      if (colon < 0) return;
      const length = Number(buffer.subarray(0, colon).toString());
      if (buffer.length < colon + 1 + length) return;
      const body = buffer.subarray(colon + 1, colon + 1 + length).toString();
      buffer = buffer.subarray(colon + 1 + length);
      let packet;
      try {
        packet = JSON.parse(body);
      } catch {
        closed_reason ??= `an unreadable packet: ${body.slice(0, 80)}`;
        socket.destroy();
        return;
      }
      dispatch(packet);
    }
  });

  // Resolves with the reply. An `error` reply rejects, with the error name in `rdp_error`.
  const request = (to, message) => new Promise((resolve, reject) => {
    if (closed_reason) {
      reject(new Error(lost_message()));
      return;
    }
    let timer;
    const entry = {
      actor: to,
      abandoned: false,
      fail: (error) => { clearTimeout(timer); reject(error); },
      settle: (reply) => {
        clearTimeout(timer);
        if (entry.abandoned) return;
        if (reply.error === undefined) {
          resolve(reply);
          return;
        }
        reject(Object.assign(new Error(`rdp: ${to} answered ${reply.error}: ${reply.message ?? ""}`), { rdp_error: reply.error }));
      },
    };
    timer = setTimeout(() => {
      entry.abandoned = true;
      reject(new Error(`rdp: no answer from ${to}`));
      // Root answers at once on a healthy Firefox. When it stays silent the debugger is stuck (the main thread is blocked), and every later request would wait out its own timeout. Closing the connection fails the shard now.
      // The stall shows first on whichever actor was asked, so any timeout probes root. A live root means only that actor is slow.
      if (to === "root") {
        if (!closed_reason) {
          closed_reason = "Firefox stopped answering the debugger: root did not reply";
          socket.destroy();
          fail_everything();
        }
      } else {
        request("root", { type: "getRoot" }).catch(() => {});
      }
    }, request_timeout_ms);
    const queue = waiting_requests.get(to) ?? [];
    waiting_requests.set(to, queue);
    queue.push(entry);
    const text = JSON.stringify({ to, ...message });
    socket.write(`${Buffer.byteLength(text)}:${text}`);
  });

  // Takes the oldest event of `actor` that `matches`. The caller names the event it wants, with an id where events repeat, so a late event that nobody took cannot mislead another caller.
  const next_event = (actor, matches = () => true, timeout_ms = DEFAULT_REQUEST_TIMEOUT_MS) => new Promise((resolve, reject) => {
    let timer;
    const read = () => {
      const queue = event_queues.get(actor) ?? [];
      const index = queue.findIndex(matches);
      if (index >= 0) {
        finish();
        resolve(queue.splice(index, 1)[0]);
      } else if (closed_reason) {
        finish();
        reject(new Error(lost_message(actor)));
      }
    };
    const finish = () => { clearTimeout(timer); event_readers.delete(read); };
    event_readers.add(read);
    timer = setTimeout(() => {
      finish();
      reject(new Error(`rdp: no event from ${actor}`));
    }, timeout_ms);
    read();
  });

  // The handler sees each event of `actor` as it arrives and returns true to consume it, so state follows the events without a reader being there.
  const subscribe = (actor, handler) => { event_subscribers.set(actor, handler); };

  await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  // A Firefox that accepts the connection but never greets would hang the caller, so the wait ends as the old client's did.
  const greeting_timer = setTimeout(() => {
    closed_reason ??= "no greeting";
    socket.destroy();
    fail_everything();
  }, request_timeout_ms);
  try {
    await greeting;
  } catch (error) {
    socket.destroy();
    throw error;
  } finally {
    clearTimeout(greeting_timer);
  }
  // The polling pauses of this client go through here, so the timings can charge them to the debugger.
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  return { request, next_event, subscribe, on_close: (listener) => { close_listeners.add(listener); return () => close_listeners.delete(listener); }, pause, lost_reason: () => closed_reason, close: () => {
    closed_reason ??= "closed by the test";
    socket.destroy();
    fail_everything();
  } };
}

export async function install_temporary_addon(rdp, addon_path) {
  const { addonsActor } = await rdp.request("root", { type: "getRoot" });
  const reply = await rdp.request(addonsActor, { type: "installTemporaryAddon", addonPath: addon_path });
  if (!reply.addon) throw new Error(`rdp: install failed: ${JSON.stringify(reply)}`);
  return reply.addon;
}

// The live background page of an add-on, per connection, kept from the watcher's events as they arrive.
// Firefox sends a target form once per watcher, and the add-on reuses one watcher for the whole run, so a second watchTargets sends none. State must come from the events, not from asking again.
const background_trackers = new WeakMap();

const is_console_target_form = (event) => event.type === "target-available-form" && event.target?.consoleActor !== undefined;
// The watcher sends a form for every extension frame, newtab and home tabs too. Only the background page counts.
const is_background_target_form = (event) => is_console_target_form(event) && event.target.url?.endsWith("/_generated_background_page.html");

function background_tracker(rdp, addon_id) {
  if (!background_trackers.has(rdp)) background_trackers.set(rdp, new Map());
  const trackers = background_trackers.get(rdp);
  if (!trackers.has(addon_id)) {
    const attached = attach_background_tracker(rdp, addon_id);
    trackers.set(addon_id, attached);
    attached.catch(() => trackers.delete(addon_id));
  }
  return trackers.get(addon_id);
}

async function attach_background_tracker(rdp, addon_id) {
  const { addons } = await rdp.request("root", { type: "listAddons" });
  const addon = addons.find((entry) => entry.id === addon_id);
  if (!addon) throw new Error(`rdp: add-on ${addon_id} is not listed`);
  const watcher = await rdp.request(addon.actor, { type: "getWatcher", isServerTargetSwitchingEnabled: false });
  const live_targets = [];
  const arrival_listeners = new Set();
  rdp.subscribe(watcher.actor, (event) => {
    if (event.type === "target-destroyed-form") {
      const destroyed_at = live_targets.findIndex((target) => target.target_actor === event.target?.actor);
      if (destroyed_at >= 0) live_targets.splice(destroyed_at, 1);
      return true;
    }
    if (event.type !== "target-available-form") return false;
    if (is_background_target_form(event)) {
      live_targets.push({ target_actor: event.target.actor, console_actor: event.target.consoleActor });
      for (const listener of [...arrival_listeners]) listener();
    }
    return true;
  });
  await rdp.request(watcher.actor, { type: "watchTargets", targetType: "frame" });
  return {
    // The newest live page. With none live, a reload is under way and its form is the next event.
    console_actor: (timeout_ms = 10000) => new Promise((resolve, reject) => {
      const answer = () => {
        if (live_targets.length === 0) return false;
        clearTimeout(timer);
        arrival_listeners.delete(answer);
        stop_watching_close();
        resolve(live_targets.at(-1).console_actor);
        return true;
      };
      const lost = () => {
        clearTimeout(timer);
        arrival_listeners.delete(answer);
        reject(new Error(`rdp: connection to Firefox lost (${rdp.lost_reason()}) while waiting for the background page of ${addon_id}`));
      };
      const stop_watching_close = rdp.on_close(lost);
      const timer = setTimeout(() => {
        arrival_listeners.delete(answer);
        stop_watching_close();
        reject(new Error(`rdp: no background page of ${addon_id} came up`));
      }, timeout_ms);
      if (answer()) return;
      // A socket that closed before this wait began fires no close hook.
      if (rdp.lost_reason()) {
        stop_watching_close();
        lost();
        return;
      }
      arrival_listeners.add(answer);
    }),
    forget: (console_actor) => {
      const index = live_targets.findIndex((target) => target.console_actor === console_actor);
      if (index >= 0) live_targets.splice(index, 1);
    },
  };
}

// Runs async code in the add-on's background page and returns its JSON result.
// Only a noSuchActor reply proves the page is gone (a reload kills it): then the next page is used. A slow or failed call says nothing about the page, so the page stays.
export async function evaluate_in_background(rdp, addon_id, async_code) {
  for (let attempt = 0; ; attempt++) {
    const tracker = await background_tracker(rdp, addon_id);
    const console_actor = await tracker.console_actor();
    try {
      return await run_in_console(rdp, console_actor, async_code);
    } catch (error) {
      if (error.rdp_error !== "noSuchActor" || attempt >= 1) throw error;
      tracker.forget(console_actor);
    }
  }
}

// The parent-process console, per connection. Firefox keeps every target it hands out until the connection closes, so asking on each call leaked one target per call.
const parent_consoles = new Map();

async function parent_console(rdp) {
  if (!parent_consoles.has(rdp)) {
    const { processDescriptor } = await rdp.request("root", { type: "getProcess", id: 0 });
    const { process } = await rdp.request(processDescriptor.actor, { type: "getTarget" });
    parent_consoles.set(rdp, process.consoleActor);
  }
  return parent_consoles.get(rdp);
}

// Runs async code in Firefox's parent process, with chrome privileges.
// Like the background page, the console is dropped only on a noSuchActor reply.
export async function evaluate_in_chrome(rdp, async_code) {
  for (let attempt = 0; ; attempt++) {
    const console_actor = await parent_console(rdp);
    try {
      return await run_in_console(rdp, console_actor, async_code);
    } catch (error) {
      if (error.rdp_error !== "noSuchActor" || attempt >= 1) throw error;
      parent_consoles.delete(rdp);
    }
  }
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
      // A frame that closes between the listing and this read leaves a dead window behind. It counts as gone, as a frame the listing missed would.
      try {
        const frame_window = chrome_global.BrowsingContext.get(${context_id})?.window;
        return frame_window ? (${frame_code})(frame_window) : null;
      } catch (error) {
        if (String(error).includes("dead object")) return null;
        throw error;
      }
    })()`);
    if (value?.error) throw new Error(`rdp: reading the ${frame_path} frame failed: ${value.error}`);
    if (value !== null) values.push(value);
  }
  return values;
}

async function evaluate(rdp, console_actor, text) {
  const ack = await rdp.request(console_actor, { type: "evaluateJSAsync", text });
  const result = await rdp.next_event(console_actor, (event) => event.type === "evaluationResult" && event.resultID === ack.resultID);
  if (result.exception) throw new Error(`rdp: evaluation threw: ${JSON.stringify(result.exceptionMessage ?? result.exception)}`);
  return result.result;
}
