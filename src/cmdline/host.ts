// The `cmdline` bundle. The first `:` injects it into the page. It shows the command line page in an iframe at the bottom,
// takes the keys typed until that page is ready, and carries a parsed command to the background.
// It stays small because it runs inside the page's own script world.

import type { BundleHostApi } from "../content/bundle_host.ts";
import type { HostToPage, PageToHost } from "./protocol.ts";
import { unwrap, wrap } from "./protocol.ts";

type CmdlineWindow = { oasisfox_host: BundleHostApi; oasisfox_cmdline_ready?: true };
const page = window as unknown as CmdlineWindow;

// The page must say ready within this time, or a page that blocks the iframe would hold every key.
const READY_TIMEOUT_MS = 3000;
// Room for the line and an error above it. The page draws its background only on the part it uses.
const BAR_HEIGHT = "5rem";

type Open = {
  frame: HTMLIFrameElement;
  holder: HTMLElement;
  secret: string;
  // Set once the page is ready. Every message after `start` goes over it.
  port?: MessagePort;
  typed: string[];
  text: string;
  timer: ReturnType<typeof setTimeout>;
};

// `crypto.randomUUID` needs a secure context, and the page may be plain http.
function random_secret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// A second run would add a second sink and listener.
if (!page.oasisfox_cmdline_ready) {
  page.oasisfox_cmdline_ready = true;
  const host = page.oasisfox_host;
  const origin = new URL(browser.runtime.getURL("cmdline.html")).origin;
  let open: Open | undefined;

  const unmount = () => {
    if (!open) return;
    clearTimeout(open.timer);
    open.port?.close();
    open.holder.remove();
    open = undefined;
  };

  // Mode first: the exit hook then runs `unmount`, and the keys of the page return to the keymap.
  const close = () => {
    host.set_mode("normal");
    unmount();
  };

  function mount(text: string) {
    const holder = document.createElement("div");
    holder.style.cssText = `all:initial;position:fixed;left:0;right:0;bottom:0;height:${BAR_HEIGHT};z-index:2147483647;`;
    const frame = document.createElement("iframe");
    const secret = random_secret();
    frame.name = secret;
    frame.src = browser.runtime.getURL("cmdline.html");
    frame.style.cssText = "all:initial;display:block;width:100%;height:100%;border:0;color-scheme:normal;";
    holder.attachShadow({ mode: "closed" }).append(frame);
    (document.body ?? document.documentElement).append(holder);
    open = { frame, holder, secret, typed: [], text, timer: setTimeout(close, READY_TIMEOUT_MS) };
  }

  async function submit(message: Extract<PageToHost, { kind: "submit" }>) {
    close();
    // The router refuses with its own toast, so a refusal in the answer is not shown again.
    await browser.runtime.sendMessage({ type: "run", invocations: [message.invocation], mode: "normal" });
  }

  const start = (current: Open) => {
    clearTimeout(current.timer);
    const channel = new MessageChannel();
    channel.port1.onmessage = (event: MessageEvent) => {
      const message = unwrap<PageToHost>(event.data);
      if (open !== current || !message) return;
      if (message.kind === "close") close();
      else if (message.kind === "submit") void submit(message);
    };
    current.port = channel.port1;
    current.frame.focus();
    const message: HostToPage = { kind: "start", secret: current.secret, text: current.text, tokens: current.typed };
    current.frame.contentWindow?.postMessage(wrap(message), origin, [channel.port2]);
    current.typed = [];
  };

  // Only `ready` comes this way. A `close` or `submit` here is forged, since the page sends those over the port.
  window.addEventListener("message", (event) => {
    const message = unwrap<PageToHost>(event.data);
    if (open && !open.port && message?.kind === "ready" && event.source === open.frame.contentWindow) start(open);
  });

  host.register_sink("cmdline", {
    on_token: (token) => {
      if (!open) return "pass";
      if (open.port) open.port.postMessage(wrap<HostToPage>({ kind: "token", token }));
      else open.typed.push(token);
      return "handled";
    },
    exit: unmount,
  });

  host.register_handler("cmdline.open", (args) => {
    if (open) return;
    mount(typeof args.text === "string" ? args.text : "");
    host.set_mode("cmdline");
  });
}
