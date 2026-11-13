// The `cmdline` bundle. The first `:` injects it into the page. It shows the command line page in an iframe at the bottom,
// takes the keys typed until that page is ready, and carries a parsed command to the background.
// It stays small because it runs inside the page's own script world.

import type { BundleHostApi } from "../content/bundle_host.ts";
import type { HeadingItem, Outcome } from "../shared/messages.ts";
import { LAYER_ATTRIBUTE, LAYERS, RESTACKED_EVENT } from "../shared/layers.ts";
import type { HostToPage, PageToHost } from "./protocol.ts";
import { unwrap, wrap } from "./protocol.ts";
import { relay, relay_outcome } from "../content/relay.ts";
import { is_too_small_to_show } from "../content/hidden_frame.ts";
import { best_effort, refused_as } from "../shared/swallow.ts";

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

// A top frame shorter than this has no room for the line, so the line draws in the frame that holds the keys.
const NO_ROOM_PX = 120;
// The subframe reads this refusal and draws the line itself, so the user never sees it.
const NO_ROOM = "No room";
// A frame asked for a line it no longer holds, or a top frame asked for a frame that is gone.
const NOT_HERE: Outcome = { ok: false, message: "The frame is gone" };
// After the line's answer, a subframe that has not heard the end of the line from the top frame ends it on its own.
const END_GRACE_MS = 2000;

// A subframe holds the keys while the top frame draws its line. It sends the keys it gets to the top frame and ends when the top frame says the line ended. `id` names this line, so a late message for an older line, or for a page this frame has since navigated to, finds nothing.
type Remote = {
  id_: string;
  // The keys sent so far, which a line drawn here after all starts with.
  sent_: string[];
  // The top frame gave the focus back. Keys now come to this frame, and wait here until the end.
  ending_: boolean;
  // The keys that wait for the end: those after the focus came back, and those the top frame did not take.
  late_: string[];
};

type Open = {
  frame_: HTMLIFrameElement;
  holder_: HTMLElement;
  // Set when the line is drawn here for the keys of this subframe: the frame and the id of its `Remote`.
  target_?: { frame_: number; id_: string } | undefined;
  // From the background. Only `start` carries it, to the frame's window at the extension origin, and the page
  // redeems it for the history and commands. Never in the frame's name or URL: while the frame still holds
  // about:blank it is same-origin with the page, which can read both.
  ticket_: Promise<unknown>;
  // The frame said `ready` once. Another `ready` means it loaded again.
  said_ready_: boolean;
  // Set at `start`. Every message after `start` goes over it.
  port_?: MessagePort;
  // The page redeemed its ticket and took over the keys.
  page_opened_: boolean;
  // Runs from a frame load until the page answers the check.
  check_timer_?: ReturnType<typeof setTimeout>;
  removal_watch_: MutationObserver;
  typed_: string[];
  text_: string;
  // The mode the key was pressed in, sent to the page in `start`.
  from_mode_: string;
  // Set when the line is a page search, and the way it searches. Enter sets `committed_`, and the end of the line tells the search whether to keep its match.
  search_?: "forward" | "backward" | undefined;
  // Read before the frame joins the page, so it is the scroll place the user saw when pressing the key.
  scroll_: { top: number; max: number } | null;
  committed_: boolean;
  // The line asked for the headings, so the hints bundle holds a snapshot of them. `submit` sets `submitted_`: the command that
  // runs next may be `heading.go`, which needs the snapshot, so the line drops it only after the command ran.
  asked_headings_: boolean;
  submitted_: boolean;
  // The end of the page search, once the line has closed. Enter waits for it, so the next step sees the committed match.
  search_ended_?: Promise<Outcome>;
  // Set once the line ended. It takes the keys the frame got after the end and removes the frame.
  hand_back_?: (tokens: readonly string[]) => void;
  // Settles the promise `cmdline.open` returned. The first call wins, so Enter settles it before `close` ends the line as cancelled.
  finish_: (outcome: Outcome | Promise<Outcome>) => void;
  timer_: ReturnType<typeof setTimeout>;
};

// A second run would add a second sink and listener.
if (!page.desertfox_cmdline_ready) {
  page.desertfox_cmdline_ready = true;
  const host = page.desertfox_host;
  const origin = new URL(browser.runtime.getURL("cmdline.html")).origin;
  let open: Open | undefined;
  let remote: Remote | undefined;
  // The id of the last line this frame sent up. Its focus comes back even when the mode left the line first, as the end of a fullscreen does.
  let sent_line_id: string | undefined;

  // Keys typed fast after Enter or Escape still reach the frame until Firefox moves the focus. So the focus moves to the
  // page first and the page's keys wait, the frame hands back its late keys, they replay, and only then the frame goes.
  const unmount = () => {
    const current = open;
    if (!current) return;
    open = undefined;
    current.finish_({ ok: true, cancelled: true });
    clearTimeout(current.timer_);
    clearTimeout(current.check_timer_);
    current.removal_watch_.disconnect();
    if (current.asked_headings_ && !current.submitted_) clear_headings(current);
    const target = current.target_;
    if (current.search_) current.search_ended_ = host.run_command_("find.end", "caret", { keep: current.committed_ });
    // The focus goes back to the subframe whose keys opened the line, if it still takes it. Otherwise the page gets it as usual.
    const focus_back = target ? relay(target.frame_, "cmdline.focus", { remote_id: target.id_ }) : undefined;
    host.hold_keys_until_(
      new Promise((handed_back) => {
        const finish_hand_back = (tokens: readonly string[]) => {
          clearTimeout(timer);
          current.port_?.close();
          current.holder_.remove();
          // The keys the line got after its end belong to the subframe that got the focus.
          if (!target || !focus_back) return handed_back(tokens);
          // A frame that refused the focus still hears the end, so it stops sending keys up to a line that is gone.
          void focus_back.then((returned) => {
            void relay(target.frame_, "cmdline.end", { remote_id: target.id_, tokens: returned ? tokens : [] });
            handed_back(returned ? [] : tokens);
          });
        };
        const timer = setTimeout(finish_hand_back, HAND_BACK_TIMEOUT_MS, []);
        current.hand_back_ = finish_hand_back;
        // The focus lands on the page itself, as a removed frame leaves it, and never back on a field or link: a field would turn the line's end into insert mode.
        if (focus_back) void focus_back.then((returned) => returned || current.frame_.blur());
        else current.frame_.blur();
        // Until `opened` the host never focused the frame, and the page may not listen on its port yet.
        if (current.page_opened_) send(current.port_, { kind: "drain" });
        else finish_hand_back([]);
      }),
    );
  };

  // Mode first: the exit hook then runs `unmount`, and the keys of the page return to the keymap.
  const close = () => {
    host.escape_();
    unmount();
  };

  // `scroll` is given for a subframe's line: the status shows that frame's place, not the top frame's.
  function mount(text: string, from_mode_: string, finish: (outcome: Outcome | Promise<Outcome>) => void, search?: "forward" | "backward", target_?: Open["target_"], typed: string[] = [], scroll = read_scroll()) {
    const holder = document.createElement("div");
    // A top-layer popover like the other surfaces. It is shown last, so it draws above them. It is not made by `create_surface`: its
    // shadow root and text would cost the 4 KB budget of this bundle.
    holder.setAttribute("popover", "manual");
    holder.setAttribute(LAYER_ATTRIBUTE, String(LAYERS.command_line));
    holder.style.cssText = `all:initial;position:fixed;left:0;right:0;bottom:0;height:${BAR_HEIGHT};z-index:${LAYERS.command_line};`;
    const frame = document.createElement("iframe");
    // A color-scheme mismatch between the iframe and its page paints the frame white. See docs/firefox-behavior.md.
    frame.style.cssText = "all:initial;display:block;width:100%;height:100%;border:0;color-scheme:light dark;";
    // Before the frame joins the page, so its only load is cmdline.html.
    frame.src = browser.runtime.getURL("cmdline.html");
    const current: Open = {
      frame_: frame,
      holder_: holder,
      // A failed request reads as no ticket, so `ready` closes the line.
      ticket_: refused_as(browser.runtime.sendMessage({ type: "issue_cmdline_ticket", target_frame: target_?.frame_ }), undefined),
      said_ready_: false,
      page_opened_: false,
      // A page that removes the bar would leave the sink taking every key with nobody to show them.
      removal_watch_: new MutationObserver(() => {
        if (open === current && !holder.isConnected) close();
      }),
      typed_: typed,
      target_,
      text_: text,
      from_mode_,
      search_: search,
      scroll_: scroll,
      committed_: false,
      asked_headings_: false,
      submitted_: false,
      finish_: finish,
      timer_: setTimeout(close, READY_TIMEOUT_MS),
    };
    // A page script can send the frame somewhere else, and then the port is dead. Firefox gives no event for that, so
    // each load asks the page whether it is still there. Counting loads fails: the order of this event, `ready` and
    // `opened` is not fixed. Before `opened` the page may still be redeeming its ticket and cannot answer, and the
    // ready timer covers that time.
    frame.addEventListener("load", () => {
      if (open !== current || !current.port_ || !current.page_opened_) return;
      clearTimeout(current.check_timer_);
      current.check_timer_ = setTimeout(() => open === current && close(), CHECK_TIMEOUT_MS);
      send(current.port_, { kind: "check" });
    });
    holder.attachShadow({ mode: "closed" }).append(frame);
    // On the root, where `mount_surface` looks for hosts, and never moved again: moving the holder reloads the frame.
    document.documentElement.append(holder);
    holder.showPopover();
    // A surface mounted later showed the holder again, and that dropped the frame's focus. The page puts it back in the input, which keeps its caret and selection.
    holder.addEventListener(RESTACKED_EVENT, () => {
      if (open !== current || !current.page_opened_) return;
      current.frame_.focus();
      send(current.port_, { kind: "refocus" });
    });
    current.removal_watch_.observe(document, { childList: true, subtree: true });
    open = current;
  }

  async function submit(current: Open, message: Extract<PageToHost, { kind: "submit" }>) {
    // The line is done once the submitted command has run, so a sequence resumes after it. Its failure is not the sequence's:
    // the router refuses with its own toast, so a refusal in the answer is not shown again.
    let answered!: () => void;
    current.finish_(new Promise<Outcome>((resolve) => (answered = () => resolve({ ok: true }))));
    current.submitted_ = true;
    close();
    await best_effort(browser.runtime.sendMessage({ type: "run", invocations: [message.invocation], mode: "normal", from_line: true }));
    if (current.asked_headings_) clear_headings(current);
    answered();
  }

  const send = (port: MessagePort | undefined, message: HostToPage) => port?.postMessage(wrap<HostToPage>(message));

  function read_scroll(): Open["scroll_"] {
    const root = document.scrollingElement;
    return root && { top: root.scrollTop, max: root.scrollHeight - root.clientHeight };
  }

  // The snapshot of headings sits in the frame that read it.
  const clear_headings = (current: Open) => (current.target_ ? void relay(current.target_.frame_, "cmdline.headings_ask", { clear: true }) : void host.run_command_("heading.clear", "hints", {}));

  const start = (current: Open, ticket: string) => {
    const channel = new MessageChannel();
    // A late answer for a line that is gone goes nowhere.
    const tell = (message: HostToPage) => open === current && send(current.port_, message);
    channel.port1.onmessage = (event: MessageEvent) => {
      const message = unwrap<PageToHost>(event.data);
      // The line has ended by then, so `open` is no longer this line.
      if (message?.kind === "drained") return current.hand_back_?.(message.tokens);
      if (open !== current || !message) return;
      // The page redeemed the ticket and can take keys itself. Until then the ready timer still runs.
      if (message.kind === "opened") {
        clearTimeout(current.timer_);
        current.page_opened_ = true;
        current.frame_.focus();
        send(channel.port1, { kind: "focused" });
      } else if (message.kind === "here") clearTimeout(current.check_timer_);
      else if (message.kind === "close") close();
      else if (message.kind === "resize" && Number.isFinite(message.height)) current.holder_.style.height = `${Math.min(message.height, window.innerHeight)}px`;
      else if (message.kind === "submit") void submit(current, message);
      else if (message.kind === "list_headings") {
        current.asked_headings_ = true;
        // The hints bundle may still be loading, so the line can close first. Its `heading.clear` then runs after this handler, and the late answer goes nowhere.
        const report = (items: HeadingItem[]) => tell({ kind: "headings", items });
        // The headings are the focused subframe's: it reads them and sends them back.
        if (current.target_) void relay(current.target_.frame_, "cmdline.headings_ask", { remote_id: current.target_.id_ }).then((asked) => asked || report([]));
        else void host.run_command_("heading.list", "hints", { report }).then((outcome) => outcome.ok || report([]));
      } else if (message.kind === "find_text") {
        const report = (status: string) => tell({ kind: "find_status", text: status });
        void host.run_command_("find.live", "caret", { text: message.text, report }).then((outcome) => outcome.ok || report(outcome.message));
      } else if (message.kind === "find_commit") {
        current.committed_ = true;
        let ended!: (outcome: Outcome) => void;
        current.finish_(new Promise<Outcome>((resolve) => (ended = resolve)));
        close();
        void (current.search_ended_ ?? Promise.resolve<Outcome>({ ok: true })).then(ended);
      }
    };
    current.port_ = channel.port1;
    const message: HostToPage = { kind: "start", ticket, text: current.text_, tokens: current.typed_, mode: current.from_mode_, search: current.search_, scroll: current.scroll_ };
    current.frame_.contentWindow?.postMessage(wrap(message), origin, [channel.port2]);
    current.typed_ = [];
  };

  // Only `ready` comes this way. A `close` or `submit` here is forged, since the page sends those over the port.
  window.addEventListener("message", (event) => {
    const current = open;
    const message = unwrap<PageToHost>(event.data);
    if (!current || message?.kind !== "ready" || event.source !== current.frame_.contentWindow) return;
    if (current.said_ready_) return close();
    current.said_ready_ = true;
    void current.ticket_.then((ticket) => {
      if (open !== current) return;
      if (typeof ticket === "string") start(current, ticket);
      else close();
    });
  });

  // One key for the open line, from this frame's keyboard or relayed from the subframe the line is for.
  const take_token = (current: Open, token: string) => {
    // Here and not in the page, so Escape closes even when the page or its port is gone.
    if (token === "<Escape>") close();
    else if (current.port_) send(current.port_, { kind: "token", token });
    else current.typed_.push(token);
  };

  // The subframe's own end of a line the top frame draws. The top frame says when the line ended and hands over the keys its frame got late.
  const end_remote = (current: Remote, tokens: readonly string[]) => {
    if (remote !== current) return;
    remote = undefined;
    host.hold_keys_until_(Promise.resolve([...tokens, ...current.late_]));
    host.escape_();
  };

  host.register_sink_("cmdline", {
    on_token_: (token) => {
      const current = remote;
      if (current?.ending_) current.late_.push(token);
      else if (current) {
        current.sent_.push(token);
        // A key the top frame did not take came after its line ended, or before it opened: it waits here for the end, or for a line drawn here.
        void relay("top", "cmdline.token", { token }).then((taken) => taken || (remote === current ? current.late_.push(token) : host.hold_keys_until_(Promise.resolve([token]))));
      } else if (!open) return "pass";
      else take_token(open, token);
      return "handled";
    },
    exit: () => {
      // The mode ended some other way (a page change): the line in the top frame has nobody to type for.
      if (remote) void relay("top", "cmdline.token", { token: "<Escape>" });
      remote = undefined;
      unmount();
    },
  });

  function open_here(args: Record<string, unknown>, from_mode: string, typed: string[] = [], target?: Open["target_"], scroll?: Open["scroll_"]): Promise<Outcome> {
    return new Promise<Outcome>((finish) => {
      mount(typeof args.text === "string" ? args.text : "", from_mode, finish, args.search === "forward" || args.search === "backward" ? args.search : undefined, target, typed, scroll);
      host.set_mode_("cmdline");
    });
  }

  // The keys come to this subframe, and the top frame draws the line. A top frame that cannot show it leaves the line to this frame, with the keys sent so far.
  async function open_remote(args: Record<string, unknown>): Promise<Outcome> {
    const current: Remote = { id_: crypto.randomUUID(), sent_: [], ending_: false, late_: [] };
    const from_mode = host.get_mode();
    remote = current;
    sent_line_id = current.id_;
    host.set_mode_("cmdline");
    const outcome = await relay_outcome("top", "cmdline.open", { text: args.text, mode: from_mode, remote_id: current.id_, scroll: read_scroll() });
    if (remote === current && (outcome === undefined || (!outcome.ok && outcome.message === NO_ROOM))) {
      remote = undefined;
      return open_here(args, from_mode, current.sent_);
    }
    // The line is over. The top frame normally says so first, and this ends it when its message never comes.
    setTimeout(end_remote, END_GRACE_MS, current, []);
    return outcome ?? { ok: true, cancelled: true };
  }

  // Pending until the user submits, commits a search or leaves the line.
  host.register_handler_("cmdline.open", (args): Outcome | Promise<Outcome> => {
    // Joining the open line would let two sequences resume from one Enter.
    if (open || remote) return { ok: false, message: "The command line is already open" };
    // From a subframe's relay, the line is for that frame's keys.
    const frame = typeof args.from_frame === "number" && typeof args.remote_id === "string" ? { frame_: args.from_frame, id_: args.remote_id } : undefined;
    if (frame && window.innerHeight < NO_ROOM_PX) return { ok: false, message: NO_ROOM };
    // A page search in a subframe draws its line in that frame, which searches itself.
    if (!frame && window !== window.top && args.search === undefined) return open_remote(args);
    if (!frame) return open_here(args, host.get_mode());
    return open_here(args, (args.mode as string | undefined) ?? host.get_mode(), [], frame, (args.scroll as Open["scroll_"] | undefined) ?? null);
  });

  // Not commands: only the background relays them (`shared/relay.ts`).
  const from_target = (args: Record<string, unknown>) => open?.target_?.frame_ === args.from_frame;
  // A key for no open line is refused, so the subframe keeps it.
  host.register_handler_("cmdline.token", (args): Outcome | void => (open && from_target(args) && typeof args.token === "string" ? take_token(open, args.token) : NOT_HERE));
  host.register_handler_("cmdline.headings", (args) => void (open && from_target(args) && send(open.port_, { kind: "headings", items: args.items as HeadingItem[] })));
  const asked_of_this_line = (args: Record<string, unknown>) => remote?.id_ === args.remote_id;
  // The top frame hands the focus back. A frame that is hidden now, or that no longer holds this line, refuses, and the top frame keeps the focus.
  host.register_handler_("cmdline.focus", (args): Outcome => {
    if (args.remote_id !== sent_line_id || is_too_small_to_show({ width: innerWidth, height: innerHeight })) return NOT_HERE;
    if (remote) remote.ending_ = true;
    window.focus();
    return { ok: true };
  });
  host.register_handler_("cmdline.end", (args) => void (remote && asked_of_this_line(args) && end_remote(remote, Array.isArray(args.tokens) ? (args.tokens as string[]) : [])));
  host.register_handler_("cmdline.headings_ask", (args): Outcome | Promise<Outcome> => {
    if (args.clear === true) return host.run_command_("heading.clear", "hints", {});
    if (!asked_of_this_line(args)) return NOT_HERE;
    const report = (items: HeadingItem[]) => void relay("top", "cmdline.headings", { items });
    return host.run_command_("heading.list", "hints", { report });
  });
}
