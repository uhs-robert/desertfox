// The `cmdline` bundle. The first `:` injects it into the page. It shows the command line page in an iframe at the bottom,
// takes the keys typed until that page is ready, and carries a parsed command to the background.
// It stays small because it runs inside the page's own script world.

import type { BundleHostApi } from "../content/bundle_host.ts";
import type { HeadingItem, Outcome } from "../shared/messages.ts";
import { LAYER_ATTRIBUTE, LAYERS, RESTACKED_EVENT } from "../shared/layers.ts";
import type { HostToPage, PageToHost } from "./protocol.ts";
import { unwrap, wrap } from "./protocol.ts";

type CmdlineWindow = { oasisfox_host: BundleHostApi; oasisfox_cmdline_ready?: true };
const page = window as unknown as CmdlineWindow;

// The page must open within this time, or a page that blocks the iframe would hold every key.
const READY_TIMEOUT_MS = 3000;
// Room for the line and an error above it, until the page reports what it needs with `resize`. The page draws its background only on the part it uses.
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
  // The page redeemed its ticket and took over the keys.
  page_opened: boolean;
  // Runs from a frame load until the page answers the check.
  check_timer?: ReturnType<typeof setTimeout>;
  removal_watch: MutationObserver;
  typed: string[];
  text: string;
  // The mode the key was pressed in, sent to the page in `start`.
  from_mode: string;
  // Set when the line is a page search, and the way it searches. Enter sets `committed`, and the end of the line tells the search whether to keep its match.
  search?: "forward" | "backward" | undefined;
  committed: boolean;
  // The line asked for the headings, so the hints bundle holds a snapshot of them. `submit` sets `submitted`: the command that
  // runs next may be `heading.go`, which needs the snapshot, so the line drops it only after the command ran.
  asked_headings: boolean;
  submitted: boolean;
  // The end of the page search, once the line has closed. Enter waits for it, so the next step sees the committed match.
  search_ended?: Promise<Outcome>;
  // Settles the promise `cmdline.open` returned. The first call wins, so Enter settles it before `close` ends the line as cancelled.
  finish: (outcome: Outcome | Promise<Outcome>) => void;
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
    open.finish({ ok: true, cancelled: true });
    clearTimeout(open.timer);
    clearTimeout(open.check_timer);
    open.removal_watch.disconnect();
    if (open.asked_headings && !open.submitted) void host.run_command("heading.clear", "hints", {});
    if (open.search) open.search_ended = host.run_command("find.end", "caret", { keep: open.committed });
    open.port?.close();
    open.holder.remove();
    open = undefined;
  };

  // Mode first: the exit hook then runs `unmount`, and the keys of the page return to the keymap.
  const close = () => {
    host.set_mode("normal");
    unmount();
  };

  function mount(text: string, from_mode: string, finish: (outcome: Outcome | Promise<Outcome>) => void, search?: "forward" | "backward") {
    const holder = document.createElement("div");
    // A top-layer popover like the other surfaces. It is shown last, so it draws above them. It is not made by `create_surface`: its
    // shadow root and text would cost the 4 KB budget of this bundle.
    holder.setAttribute("popover", "manual");
    holder.setAttribute(LAYER_ATTRIBUTE, String(LAYERS.command_line));
    holder.style.cssText = `all:initial;position:fixed;left:0;right:0;bottom:0;height:${BAR_HEIGHT};z-index:${LAYERS.command_line};`;
    holder.setAttribute("data-oasisfox-layer", String(LAYERS.command_line));
    const frame = document.createElement("iframe");
    frame.style.cssText = "all:initial;display:block;width:100%;height:100%;border:0;color-scheme:normal;";
    // Before the frame joins the page, so its only load is cmdline.html.
    frame.src = browser.runtime.getURL("cmdline.html");
    const current: Open = {
      frame,
      holder,
      // A failed request reads as no ticket, so `ready` closes the line.
      ticket: browser.runtime.sendMessage({ type: "issue_cmdline_ticket" }).catch(() => undefined),
      said_ready: false,
      page_opened: false,
      // A page that removes the bar would leave the sink taking every key with nobody to show them.
      removal_watch: new MutationObserver(() => {
        if (open === current && !holder.isConnected) close();
      }),
      typed: [],
      text,
      from_mode,
      search,
      committed: false,
      asked_headings: false,
      submitted: false,
      finish,
      timer: setTimeout(close, READY_TIMEOUT_MS),
    };
    // A page script can send the frame somewhere else, and then the port is dead. Firefox gives no event for that, so
    // each load asks the page whether it is still there. Counting loads fails: the order of this event, `ready` and
    // `opened` is not fixed. Before `opened` the page may still be redeeming its ticket and cannot answer, and the
    // ready timer covers that time.
    frame.addEventListener("load", () => {
      if (open !== current || !current.port || !current.page_opened) return;
      clearTimeout(current.check_timer);
      current.check_timer = setTimeout(() => open === current && close(), CHECK_TIMEOUT_MS);
      current.port.postMessage(wrap<HostToPage>({ kind: "check" }));
    });
    holder.attachShadow({ mode: "closed" }).append(frame);
    // On the root, where `mount_surface` looks for hosts, and never moved again: moving the holder reloads the frame.
    document.documentElement.append(holder);
    holder.showPopover();
    // A surface mounted later showed the holder again, and that dropped the frame's focus. The page puts it back in the input, which keeps its caret and selection.
    holder.addEventListener(RESTACKED_EVENT, () => {
      if (open !== current || !current.page_opened) return;
      current.frame.focus();
      current.port?.postMessage(wrap<HostToPage>({ kind: "refocus" }));
    });
    current.removal_watch.observe(document, { childList: true, subtree: true });
    open = current;
  }

  async function submit(current: Open, message: Extract<PageToHost, { kind: "submit" }>) {
    // The line is done once the submitted command has run, so a sequence resumes after it. Its failure is not the sequence's:
    // the router refuses with its own toast, so a refusal in the answer is not shown again.
    let answered!: () => void;
    current.finish(new Promise<Outcome>((resolve) => (answered = () => resolve({ ok: true }))));
    current.submitted = true;
    close();
    await browser.runtime.sendMessage({ type: "run", invocations: [message.invocation], mode: "normal" }).catch(() => undefined);
    if (current.asked_headings) void host.run_command("heading.clear", "hints", {});
    answered();
  }

  const start = (current: Open, ticket: string) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event: MessageEvent) => {
      const message = unwrap<PageToHost>(event.data);
      if (open !== current || !message) return;
      // The page redeemed the ticket and can take keys itself. Until then the ready timer still runs.
      if (message.kind === "opened") {
        clearTimeout(current.timer);
        current.page_opened = true;
        current.frame.focus();
        channel.port1.postMessage(wrap<HostToPage>({ kind: "focused" }));
      } else if (message.kind === "here") clearTimeout(current.check_timer);
      else if (message.kind === "close") close();
      else if (message.kind === "resize" && Number.isFinite(message.height)) current.holder.style.height = `${Math.min(message.height, window.innerHeight)}px`;
      else if (message.kind === "submit") void submit(current, message);
      else if (message.kind === "list_headings") {
        current.asked_headings = true;
        // The hints bundle may still be loading, so the line can close first. Its `heading.clear` then runs after this handler, and the late answer goes nowhere.
        const report = (items: HeadingItem[]) => open === current && current.port?.postMessage(wrap<HostToPage>({ kind: "headings", items }));
        void host.run_command("heading.list", "hints", { report }).then((outcome) => outcome.ok || report([]));
      } else if (message.kind === "find_text") {
        const report = (status: string) => open === current && current.port?.postMessage(wrap<HostToPage>({ kind: "find_status", text: status }));
        host.run_command("find.live", "caret", { text: message.text, report });
      } else if (message.kind === "find_commit") {
        current.committed = true;
        let ended!: (outcome: Outcome) => void;
        current.finish(new Promise<Outcome>((resolve) => (ended = resolve)));
        close();
        void (current.search_ended ?? Promise.resolve<Outcome>({ ok: true })).then(ended);
      }
    };
    current.port = channel.port1;
    const message: HostToPage = { kind: "start", ticket, text: current.text, tokens: current.typed, mode: current.from_mode, search: current.search };
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

  // Pending until the user submits, commits a search or leaves the line.
  host.register_handler("cmdline.open", (args): Outcome | Promise<Outcome> => {
    // Joining the open line would let two sequences resume from one Enter.
    if (open) return { ok: false, message: "The command line is already open" };
    return new Promise<Outcome>((finish) => {
      mount(typeof args.text === "string" ? args.text : "", host.get_mode(), finish, args.search === "forward" || args.search === "backward" ? args.search : undefined);
      host.set_mode("cmdline");
    });
  });
}
