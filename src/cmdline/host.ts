// The `cmdline` bundle. The first `:` injects it into the page. It shows the command line page in an iframe at the bottom,
// takes the keys typed until that page is ready, and carries a parsed command to the background.
// It stays small because it runs inside the page's own script world.

import type { BundleHostApi } from "../content/bundle_host.ts";
import type { HostToPage, PageToHost } from "./protocol.ts";
import { unwrap, wrap } from "./protocol.ts";

type CmdlineWindow = { oasisfox_host: BundleHostApi; oasisfox_cmdline_ready?: true };
const page = window as unknown as CmdlineWindow;

// The page must open within this time, or a page that blocks the iframe would hold every key.
const READY_TIMEOUT_MS = 3000;
// Room for the line and an error above it. The page draws its background only on the part it uses.
const BAR_HEIGHT = "5rem";
// After each load of the frame, the page must answer a check within this time, or the frame went somewhere else.
const CHECK_TIMEOUT_MS = 1000;

type Open = {
  frame: HTMLIFrameElement;
  holder: HTMLElement;
  // From the background. Only `start` carries it, to the frame's window at the extension origin, and the page
  // redeems it for the history and commands. Never in the frame's name or URL: while the frame still holds
  // about:blank it is same-origin with the page, which can read both.
  ticket: Promise<unknown>;
  // The frame said `ready` once. Another `ready` means it loaded again.
  said_ready: boolean;
  // Set at `start`. Every message after `start` goes over it.
  port?: MessagePort;
  // Runs from a frame load until the page answers the check.
  check_timer?: ReturnType<typeof setTimeout>;
  removal_watch: MutationObserver;
  typed: string[];
  text: string;
  timer: ReturnType<typeof setTimeout>;
};

// A second run would add a second sink and listener.
if (!page.oasisfox_cmdline_ready) {
  page.oasisfox_cmdline_ready = true;
  const host = page.oasisfox_host;
  const origin = new URL(browser.runtime.getURL("cmdline.html")).origin;
  let open: Open | undefined;

  const unmount = () => {
    if (!open) return;
    clearTimeout(open.timer);
    clearTimeout(open.check_timer);
    open.removal_watch.disconnect();
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
    frame.style.cssText = "all:initial;display:block;width:100%;height:100%;border:0;color-scheme:normal;";
    // Before the frame joins the page, so its only load is cmdline.html.
    frame.src = browser.runtime.getURL("cmdline.html");
    const current: Open = {
      frame,
      holder,
      ticket: browser.runtime.sendMessage({ type: "issue_cmdline_ticket" }),
      said_ready: false,
      // A page that removes the bar would leave the sink taking every key with nobody to show them.
      removal_watch: new MutationObserver(() => {
        if (open === current && !holder.isConnected) close();
      }),
      typed: [],
      text,
      timer: setTimeout(close, READY_TIMEOUT_MS),
    };
    // A page script can send the frame somewhere else, and then the port is dead. Firefox gives no event for that, so
    // each load asks the page whether it is still there. Counting loads fails: the order of this event, `ready` and
    // `opened` is not fixed. Before `start` there is no port to ask, and the ready timer covers that time.
    frame.addEventListener("load", () => {
      if (open !== current || !current.port) return;
      clearTimeout(current.check_timer);
      current.check_timer = setTimeout(() => open === current && close(), CHECK_TIMEOUT_MS);
      current.port.postMessage(wrap<HostToPage>({ kind: "check" }));
    });
    holder.attachShadow({ mode: "closed" }).append(frame);
    (document.body ?? document.documentElement).append(holder);
    current.removal_watch.observe(document, { childList: true, subtree: true });
    open = current;
  }

  async function submit(message: Extract<PageToHost, { kind: "submit" }>) {
    close();
    // The router refuses with its own toast, so a refusal in the answer is not shown again.
    await browser.runtime.sendMessage({ type: "run", invocations: [message.invocation], mode: "normal" });
  }

  const start = (current: Open, ticket: string) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event: MessageEvent) => {
      const message = unwrap<PageToHost>(event.data);
      if (open !== current || !message) return;
      // The page redeemed the ticket and can take keys itself. Until then the ready timer still runs.
      if (message.kind === "opened") {
        clearTimeout(current.timer);
        current.frame.focus();
        channel.port1.postMessage(wrap<HostToPage>({ kind: "focused" }));
      } else if (message.kind === "here") clearTimeout(current.check_timer);
      else if (message.kind === "close") close();
      else if (message.kind === "submit") void submit(message);
    };
    current.port = channel.port1;
    const message: HostToPage = { kind: "start", ticket, text: current.text, tokens: current.typed };
    current.frame.contentWindow?.postMessage(wrap(message), origin, [channel.port2]);
    current.typed = [];
  };

  // Only `ready` comes this way. A `close` or `submit` here is forged, since the page sends those over the port.
  window.addEventListener("message", (event) => {
    const current = open;
    const message = unwrap<PageToHost>(event.data);
    if (!current || message?.kind !== "ready" || event.source !== current.frame.contentWindow) return;
    if (current.said_ready) return close();
    current.said_ready = true;
    void current.ticket.then((ticket) => {
      if (open !== current) return;
      if (typeof ticket === "string") start(current, ticket);
      else close();
    });
  });

  host.register_sink("cmdline", {
    on_token: (token) => {
      if (!open) return "pass";
      // Here and not in the page, so Escape closes even when the page or its port is gone.
      if (token === "<Escape>") close();
      else if (open.port) open.port.postMessage(wrap<HostToPage>({ kind: "token", token }));
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
