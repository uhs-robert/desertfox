// A small WebDriver BiDi client for a headless Firefox with a throwaway profile on its own port, so it never touches a profile in use.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const connect = (port) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/session`);
    socket.onopen = () => resolve(socket);
    socket.onerror = reject;
  });

export async function launch({ port = 9371, width = 1366, height = 1100 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "desertfox-next-page-"));
  const firefox = spawn("firefox", ["--headless", "--no-remote", "--profile", profile, `--remote-debugging-port=${port}`, `--window-size=${width},${height}`, "about:blank"], { stdio: "ignore" });
  let socket;
  // Firefox takes a few seconds to open its port. A refused connection before that is expected, so it is retried for 30 s.
  for (let tries = 0; tries < 60 && !socket; tries++) {
    await sleep(500);
    socket = await connect(port).then((open) => open, (error) => (tries === 59 ? Promise.reject(error) : undefined));
  }
  let next_id = 1;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.type === "error") waiting.reject(new Error(`${message.error}: ${message.message}`));
    else waiting.resolve(message.result);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = next_id++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  await send("session.new", { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
  const { contexts } = await send("browsingContext.getTree", {});
  const context = contexts[0].context;
  const evaluate = async (expression) => {
    const result = await send("script.evaluate", { expression, target: { context }, awaitPromise: true, resultOwnership: "none" });
    if (result.type === "exception") throw new Error(`page exception: ${result.exceptionDetails.text}`);
    return result.result.value;
  };
  // A page that never finishes loading still gets captured: the wait ends after 30 s.
  const navigate = (url) => Promise.race([send("browsingContext.navigate", { context, url, wait: "interactive" }), sleep(30000)]);
  const close = async () => {
    await Promise.race([send("browser.close").then(() => undefined, (error) => console.error("browser.close:", error.message)), sleep(2000)]);
    firefox.kill();
    socket.close();
    await sleep(800);
    rmSync(profile, { recursive: true, force: true });
  };
  return { evaluate, navigate, close };
}
