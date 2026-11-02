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
  return { request, next_from, close: () => socket.destroy() };
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
  const available = await rdp.next_from(watcher.actor, (reply) => reply.type === "target-available-form" && reply.target?.consoleActor);
  return available.target.consoleActor;
}

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

async function run_in_console(rdp, console_actor, async_code) {
  const slot = `__key_test_${Math.random().toString(36).slice(2)}`;
  const start = `globalThis.${slot} = undefined; (async () => ${async_code})().then((value) => { globalThis.${slot} = JSON.stringify(value ?? null); }, (error) => { globalThis.${slot} = JSON.stringify({ error: String(error) }); }); "started"`;
  await evaluate(rdp, console_actor, start);
  for (let attempt = 0; attempt < 50; attempt++) {
    const value = await evaluate(rdp, console_actor, `globalThis.${slot}`);
    if (typeof value === "string") return JSON.parse(value);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("rdp: background code did not finish");
}

async function evaluate(rdp, console_actor, text) {
  const ack = await rdp.request(console_actor, { type: "evaluateJSAsync", text }, (reply) => "resultID" in reply);
  const result = await rdp.next_from(console_actor, (reply) => reply.type === "evaluationResult" && reply.resultID === ack.resultID);
  if (result.exception) throw new Error(`rdp: evaluation threw: ${JSON.stringify(result.exceptionMessage ?? result.exception)}`);
  return result.result;
}
