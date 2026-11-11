// The `cmdline` bundle. The first `:` injects it into the page. It shows the command line page in an iframe at the bottom,
// takes the keys typed until that page is ready, and carries a parsed command to the background.
// It stays small because it runs inside the page's own script world.

import type { BundleHostApi } from "../content/bundle_host.ts";
import type { HeadingItem, Outcome } from "../shared/messages.ts";
import { LAYER_ATTRIBUTE, LAYERS, RESTACKED_EVENT } from "../shared/layers.ts";
import type { HostToPage, PageToHost } from "./protocol.ts";
import { unwrap, wrap } from "./protocol.ts";

type CmdlineWindow = { desertfox_host: BundleHostApi; desertfox_cmdline_ready?: true };
const page = window as unknown as CmdlineWindow;

// The page must open within this time, or a page that blocks the iframe would hold every key.
const READY_TIMEOUT_MS = 3000;
// Room for the line and an error above it, until the page reports what it needs with `resize`. The page draws its background only on the part it uses.
const BAR_HEIGHT = "5rem";
// After each load of the frame, the page must answer a check within this time, or the frame went somewhere else.
const CHECK_TIMEOUT_MS = 1000;
// A line that ended holds the page's keys until its frame hands back the late ones, or this long. A dead frame never answers.
const HAND_BACK_TIMEOUT_MS = 1000;

type Open = {
  frame: HTMLIFrameElement;
  holder: HTMLElement;
  // From the background. Only `start` carries it, to the frame's window at the extension origin, and the page
  // redeems it for the history and commands. Never in the frame's name or URL: while the frame still holds
  // about:blank it is same-origin with the page, which can read both.
  ticket: Promise<unknown>;
  // The frame said `ready` once. Another `ready` means it loaded again.
  said_ready_: boolean;
  // Set at `start`. Every message after `start` goes over it.
  port?: MessagePort;
  // The page redeemed its ticket and took over the keys.
  page_opened_: boolean;
  // Runs from a frame load until the page answers the check.
  check_timer_?: ReturnType<typeof setTimeout>;
  removal_watch_: MutationObserver;
  typed: string[];
  text: string;
  // The mode the key was pressed in, sent to the page in `start`.
  from_mode_: string;
  // Set when the line is a page search, and the way it searches. Enter sets `committed`, and the end of the line tells the search whether to keep its match.
  search?: "forward" | "backward" | undefined;
  // Read before the frame joins the page, so it is the scroll place the user saw when pressing the key.
  scroll: { top: number; max: number } | null;
  committed: boolean;
  // The line asked for the headings, so the hints bundle holds a snapshot of them. `submit` sets `submitted`: the command that
  // runs next may be `heading.go`, which needs the snapshot, so the line drops it only after the command ran.
  asked_headings_: boolean;
  submitted: boolean;
  // The end of the page search, once the line has closed. Enter waits for it, so the next step sees the committed match.
  search_ended_?: Promise<Outcome>;
  // Set once the line ended. It takes the keys the frame got after the end and removes the frame.
  hand_back_?: (tokens: readonly string[]) => void;
  // Settles the promise `cmdline.open` returned. The first call wins, so Enter settles it before `close` ends the line as cancelled.
  finish: (outcome: Outcome | Promise<Outcome>) => void;
  timer: ReturnType<typeof setTimeout>;
};

// A second run would add a second sink and listener.
if (!page.desertfox_cmdline_ready) {
  page.desertfox_cmdline_ready = true;
  const host = page.desertfox_host;
  const origin = new URL(browser.runtime.getURL("cmdline.html")).origin;
  let open: Open | undefined;

  // Keys typed fast after Enter or Escape still reach the frame until Firefox moves the focus. So the focus moves to the
  // page first and the page's keys wait, the frame hands back its late keys, they replay, and only then the frame goes.
  const unmount = () => {
    const current = open;
    if (!current) return;
    open = undefined;
    current.finish({ ok: true, cancelled: true });
    clearTimeout(current.timer);
    clearTimeout(current.check_timer_);
    current.removal_watch_.disconnect();
    if (current.asked_headings_ && !current.submitted) void host.run_command_("heading.clear", "hints", {});
    if (current.search) current.search_ended_ = host.run_command_("find.end", "caret", { keep: current.committed });
    host.hold_keys_until_(
      new Promise((handed_back) => {
        const finish_hand_back = (tokens: readonly string[]) => {
          clearTimeout(timer);
          current.port?.close();
          current.holder.remove();
          handed_back(tokens);
        };
        const timer = setTimeout(finish_hand_back, HAND_BACK_TIMEOUT_MS, []);
        current.hand_back_ = finish_hand_back;
        // The focus lands on the page itself, as a removed frame leaves it, and never back on a field or link: a field would turn the line's end into insert mode.
        current.frame.blur();
        // Until `opened` the host never focused the frame, and the page may not listen on its port yet.
        if (current.page_opened_) send(current.port, { kind: "drain" });
        else finish_hand_back([]);
      }),
    );
  };

  // Mode first: the exit hook then runs `unmount`, and the keys of the page return to the keymap.
  const close = () => {
    host.escape_();
    unmount();
  };

  function mount(text: string, from_mode_: string, finish: (outcome: Outcome | Promise<Outcome>) => void, search?: "forward" | "backward") {
    const holder = document.createElement("div");
    // A top-layer popover like the other surfaces. It is shown last, so it draws above them. It is not made by `create_surface`: its
    // shadow root and text would cost the 4 KB budget of this bundle.
    holder.setAttribute("popover", "manual");
    holder.setAttribute(LAYER_ATTRIBUTE, String(LAYERS.command_line));
    holder.style.cssText = `all:initial;position:fixed;left:0;right:0;bottom:0;height:${BAR_HEIGHT};z-index:${LAYERS.command_line};`;
    const root = document.scrollingElement;
    const frame = document.createElement("iframe");
    // A color-scheme mismatch between the iframe and its page paints the frame white. See docs/firefox-behavior.md.
    frame.style.cssText = "all:initial;display:block;width:100%;height:100%;border:0;color-scheme:light dark;";
    // Before the frame joins the page, so its only load is cmdline.html.
    frame.src = browser.runtime.getURL("cmdline.html");
    const current: Open = {
      frame,
      holder,
      // A failed request reads as no ticket, so `ready` closes the line.
      ticket: browser.runtime.sendMessage({ type: "issue_cmdline_ticket" }).catch(() => undefined),
      said_ready_: false,
      page_opened_: false,
      // A page that removes the bar would leave the sink taking every key with nobody to show them.
      removal_watch_: new MutationObserver(() => {
        if (open === current && !holder.isConnected) close();
      }),
      typed: [],
      text,
      from_mode_,
      search,
      scroll: root && { top: root.scrollTop, max: root.scrollHeight - root.clientHeight },
      committed: false,
      asked_headings_: false,
      submitted: false,
      finish,
      timer: setTimeout(close, READY_TIMEOUT_MS),
    };
    // A page script can send the frame somewhere else, and then the port is dead. Firefox gives no event for that, so
    // each load asks the page whether it is still there. Counting loads fails: the order of this event, `ready` and
    // `opened` is not fixed. Before `opened` the page may still be redeeming its ticket and cannot answer, and the
    // ready timer covers that time.
    frame.addEventListener("load", () => {
      if (open !== current || !current.port || !current.page_opened_) return;
      clearTimeout(current.check_timer_);
      current.check_timer_ = setTimeout(() => open === current && close(), CHECK_TIMEOUT_MS);
      send(current.port, { kind: "check" });
    });
    holder.attachShadow({ mode: "closed" }).append(frame);
    // On the root, where `mount_surface` looks for hosts, and never moved again: moving the holder reloads the frame.
    document.documentElement.append(holder);
    holder.showPopover();
    // A surface mounted later showed the holder again, and that dropped the frame's focus. The page puts it back in the input, which keeps its caret and selection.
    holder.addEventListener(RESTACKED_EVENT, () => {
      if (open !== current || !current.page_opened_) return;
      current.frame.focus();
      send(current.port, { kind: "refocus" });
    });
    current.removal_watch_.observe(document, { childList: true, subtree: true });
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
    if (current.asked_headings_) void host.run_command_("heading.clear", "hints", {});
    answered();
  }

  const send = (port: MessagePort | undefined, message: HostToPage) => port?.postMessage(wrap<HostToPage>(message));

  const start = (current: Open, ticket: string) => {
    const channel = new MessageChannel();
    // A late answer for a line that is gone goes nowhere.
    const tell = (message: HostToPage) => open === current && send(current.port, message);
    channel.port1.onmessage = (event: MessageEvent) => {
      const message = unwrap<PageToHost>(event.data);
      // The line has ended by then, so `open` is no longer this line.
      if (message?.kind === "drained") return current.hand_back_?.(message.tokens);
      if (open !== current || !message) return;
      // The page redeemed the ticket and can take keys itself. Until then the ready timer still runs.
      if (message.kind === "opened") {
        clearTimeout(current.timer);
        current.page_opened_ = true;
        current.frame.focus();
        send(channel.port1, { kind: "focused" });
      } else if (message.kind === "here") clearTimeout(current.check_timer_);
      else if (message.kind === "close") close();
      else if (message.kind === "resize" && Number.isFinite(message.height)) current.holder.style.height = `${Math.min(message.height, window.innerHeight)}px`;
      else if (message.kind === "submit") void submit(current, message);
      else if (message.kind === "list_headings") {
        current.asked_headings_ = true;
        // The hints bundle may still be loading, so the line can close first. Its `heading.clear` then runs after this handler, and the late answer goes nowhere.
        const report = (items: HeadingItem[]) => tell({ kind: "headings", items });
        void host.run_command_("heading.list", "hints", { report }).then((outcome) => outcome.ok || report([]));
      } else if (message.kind === "find_text") {
        const report = (status: string) => tell({ kind: "find_status", text: status });
        host.run_command_("find.live", "caret", { text: message.text, report });
      } else if (message.kind === "find_commit") {
        current.committed = true;
        let ended!: (outcome: Outcome) => void;
        current.finish(new Promise<Outcome>((resolve) => (ended = resolve)));
        close();
        void (current.search_ended_ ?? Promise.resolve<Outcome>({ ok: true })).then(ended);
      }
    };
    current.port = channel.port1;
    const message: HostToPage = { kind: "start", ticket, text: current.text, tokens: current.typed, mode: current.from_mode_, search: current.search, scroll: current.scroll };
    current.frame.contentWindow?.postMessage(wrap(message), origin, [channel.port2]);
    current.typed = [];
  };

  // Only `ready` comes this way. A `close` or `submit` here is forged, since the page sends those over the port.
  window.addEventListener("message", (event) => {
    const current = open;
    const message = unwrap<PageToHost>(event.data);
    if (!current || message?.kind !== "ready" || event.source !== current.frame.contentWindow) return;
    if (current.said_ready_) return close();
    current.said_ready_ = true;
    void current.ticket.then((ticket) => {
      if (open !== current) return;
      if (typeof ticket === "string") start(current, ticket);
      else close();
    });
  });

  host.register_sink_("cmdline", {
    on_token_: (token) => {
      if (!open) return "pass";
      // Here and not in the page, so Escape closes even when the page or its port is gone.
      if (token === "<Escape>") close();
      else if (open.port) send(open.port, { kind: "token", token });
      else open.typed.push(token);
      return "handled";
    },
    exit: unmount,
  });

  // Pending until the user submits, commits a search or leaves the line.
  host.register_handler_("cmdline.open", (args): Outcome | Promise<Outcome> => {
    // Joining the open line would let two sequences resume from one Enter.
    if (open) return { ok: false, message: "The command line is already open" };
    return new Promise<Outcome>((finish) => {
      mount(typeof args.text === "string" ? args.text : "", host.get_mode(), finish, args.search === "forward" || args.search === "backward" ? args.search : undefined);
      host.set_mode_("cmdline");
    });
  });
}
