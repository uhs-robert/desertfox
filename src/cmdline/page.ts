// The command line page, shown in an iframe by the `cmdline` bundle. It has its own matcher over the stored keymap,
// because the content script's keys cannot reach into the iframe. Enter parses the line with the shared grammar
// and hands the invocation to the host script, which runs it from the page's own frame.

import { create_matcher, event_to_token } from "../shared/keys/index.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import { check_args_shape } from "../shared/registry/check_shape.ts";
import { parse_command_line } from "../shared/registry/command_line.ts";
import type { CmdlineOpened, CompleteItemsAnswer, ContentToBackground, HeadingItem, TabRowsActionAnswer, TabModelMessage, TabModelRequest } from "../shared/messages.ts";
import { TAB_MODEL_PORT_NAME } from "../shared/tab_model_port.ts";
import { create_live_source } from "./completion/live.ts";
import { create_model_client } from "./completion/model_client.ts";
import type { ModelClient } from "./completion/model_client.ts";
import { create_completer } from "./completion/sources.ts";
import { edit_forwarded, run_token, run_token_without_keymap } from "./key_input.ts";
import type { TokenMatcher } from "./key_input.ts";
import type { HostToPage, PageToHost } from "./protocol.ts";
import { unwrap, wrap } from "./protocol.ts";
import { key_labels } from "./completion/keys.ts";
import { create_list } from "./list.ts";
import { wheel_rows } from "./wheel.ts";
import type { Wheel_state } from "./wheel.ts";
import { create_session } from "./session.ts";
import type { Effect, Session } from "./session.ts";
import { status_widgets } from "./status.ts";
import { create_word_lookup } from "./word_lookup.ts";
import { follow_theme, follow_user_css } from "../shared/theme/apply.ts";

// Starts with the page, not after the round trips of `open_line`, and after the built-in styles, so the theme beats the hex defaults.
follow_theme(".desertfox-cmdline");
follow_user_css();

// The port from the host's `start`. Until it arrives there is nobody to tell.
let host_port: MessagePort | undefined;

// Only `ready` goes to the parent window, see `protocol.ts`.
const tell_host = (message: PageToHost) => host_port?.postMessage(wrap(message));
const say_ready = () => window.parent.postMessage(wrap<PageToHost>({ kind: "ready" }), "*");

const ask_background = <Answer>(message: ContentToBackground) => browser.runtime.sendMessage(message) as Promise<Answer>;

type Start = Extract<HostToPage, { kind: "start" }>;

// Drawn once: each widget is a snapshot of the moment the line opened. A search line shows none, because its note row carries the match count.
function show_status(area: HTMLElement, opened: CmdlineOpened, start: Start): void {
  if (start.search) return;
  const widgets = status_widgets(opened.statusbar_widgets, opened.status, start.scroll);
  area.replaceChildren(
    ...widgets.map((widget) => {
      const element = document.createElement("span");
      element.textContent = widget.text;
      if (widget.title !== undefined) element.title = widget.title;
      if (widget.state !== undefined) element.className = `desertfox-cmdline-status-${widget.state}`;
      return element;
    }),
  );
  area.hidden = widgets.length === 0;
}

// "caret" is the markup's own default. "colon" swaps the style class. Any other value is custom text in the caret style.
function show_prompt(prompt: HTMLElement, setting: string): void {
  if (setting === "colon") {
    prompt.textContent = ":";
    prompt.className += " desertfox-cmdline-prompt-colon";
  } else if (setting !== "caret") {
    prompt.textContent = setting;
  }
}

const FALLBACK_ROW_HEIGHT_PX = 24;

// Page scripts can post a `start` too, to this frame or to a copy they embed. Only the background knows whether the
// ticket is live, so every `start` is tried and the first one it accepts wins.
async function open_line(start: Start, port: MessagePort): Promise<void> {
  const input = document.querySelector<HTMLInputElement>("#line")!;
  const note = document.querySelector<HTMLElement>("#note")!;
  const panel = document.querySelector<HTMLElement>(".desertfox-cmdline")!;

  const [stored, opened] = await Promise.all([
    browser.storage.local.get(COMPILED_KEYMAP_STORAGE_KEY),
    ask_background<CmdlineOpened | undefined>({ type: "open_cmdline", ticket: start.ticket }),
  ]);
  if (!opened || host_port) return;
  host_port = port;
  const lookup = create_word_lookup(opened.commands, opened.command_aliases);
  if (start.search) show_prompt(document.querySelector<HTMLElement>(".desertfox-cmdline-prompt")!, start.search === "forward" ? "/ " : "? ");
  else if (opened.prompt) show_prompt(document.querySelector<HTMLElement>(".desertfox-cmdline-prompt")!, opened.prompt);
  show_status(document.querySelector<HTMLElement>("#status")!, opened, start);
  const prompt = document.querySelector<HTMLElement>(".desertfox-cmdline-prompt")!;
  const line_prompt = prompt.textContent;
  const keymap = stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined;
  const opened_from = typeof start.mode === "string" ? start.mode : "normal";
  const key_text = key_labels(keymap, opened.commands, opened_from);
  const help_ids = new Set(opened.help_ids);
  const has_help = (id: string) => help_ids.has(id);
  const list = create_list(document.querySelector<HTMLElement>("#list")!, (id) => key_text.get(id) ?? "", has_help);
  const matcher: TokenMatcher | undefined = keymap?.modes.cmdline ? create_matcher(keymap) : undefined;
  // The headings are in the page, so the host script reads them and answers over the port.
  let headings_reply: ((items: HeadingItem[]) => void) | undefined;
  const ask_headings = () =>
    new Promise<CompleteItemsAnswer>((resolve) => {
      headings_reply = (items) => resolve({ items });
      tell_host({ kind: "list_headings" });
    });
  // The tab model port opens on the first tab read, and only here, after the ticket redeemed: the background admits only the frame that redeemed it.
  let model_port: browser.runtime.Port | undefined;
  let model: ModelClient | undefined;
  let model_lost = false;
  const connect_model = (): ModelClient => {
    const port = browser.runtime.connect({ name: TAB_MODEL_PORT_NAME });
    const client = create_model_client({
      line_window_id: opened.window_id,
      all_windows: opened.all_windows,
      request_resync: () => port.postMessage({ type: "resync" } satisfies TabModelRequest),
      on_change: () => {
        session.source_ready();
        render();
      },
    });
    port.onMessage.addListener((message) => client.receive(message as TabModelMessage));
    // The background closes the port when the opener check fails, before any snapshot. A list that has rows keeps them.
    port.onDisconnect.addListener(() => {
      model_lost = true;
      if (client.items() === undefined) session.set_message("could not read the tabs");
      session.source_ready();
      render();
    });
    model_port = port;
    return client;
  };
  // Asks the background for bookmarks and the like only when a subject needs them, and only here, after the ticket redeemed.
  const live = create_live_source({
    ask: (kind) => (kind === "headings" ? ask_headings() : ask_background<CompleteItemsAnswer | undefined>({ type: "complete_items", kind })),
    tabs: () => (model ??= connect_model()).items() ?? (model_lost ? [] : undefined),
    groups: () => (model ??= connect_model()).group_items() ?? (model_lost ? [] : undefined),
    all_tabs: () => (model ??= connect_model()).all_items() ?? (model_lost ? [] : undefined),
    on_ready: () => {
      session.source_ready();
      render();
    },
  });
  const close_sources = () => {
    live.close();
    model_port?.disconnect();
  };
  const session: Session = create_session({
    search: start.search !== undefined,
    history: start.search ? [] : opened.history,
    parse: (text) => parse_command_line(lookup, text, opened.sources),
    has_help,
    command_id_of: (word) => lookup.find(word)?.id,
    has_param: (command_id, name) => lookup.find(command_id)?.params?.some((param) => param.name === name) === true,
    tabs: () => model?.items(true),
    containers: opened.container_stores,
    complete: start.search ? undefined : create_completer(lookup, opened.commands, opened.command_aliases, opened.sources, opened_from, live, opened.theme_names),
    // Only a missing value is caught here. The router still checks everything else when it runs the command.
    precheck: (invocation) => {
      const command = lookup.find(invocation.id);
      const checked = command && check_args_shape(command, invocation.args, opened.sources);
      return checked && !checked.ok && checked.missing_param !== undefined ? checked.error : undefined;
    },
  });

  let wheel_rows_drawn: unknown;
  let told_height = 0;
  let told_text = "";
  const render = () => {
    // The search runs in the host's frame, so it needs each edit as it happens.
    if (start.search && session.get_text() !== told_text) tell_host({ kind: "find_text", text: (told_text = session.get_text()) });
    if (input.value !== session.get_text()) {
      input.value = session.get_text();
      input.setSelectionRange(session.get_caret(), session.get_caret());
    }
    prompt.textContent = session.get_prompt() ?? line_prompt;
    const message = session.get_message();
    // The error colour is for errors only. Without one the note shows the usage or "no match".
    const shown = message ?? session.get_hint() ?? "";
    note.textContent = shown;
    note.hidden = shown === "";
    document.body.classList.toggle("desertfox-cmdline-error", message !== undefined);
    // A new ranking starts at the top, so leftover wheel pixels belong to the old one.
    if (session.get_rows() !== wheel_rows_drawn) wheel.remainder_px = 0;
    wheel_rows_drawn = session.get_rows();
    list.render(session.get_rows(), session.get_selected(), session.get_hint() === "loading", session.get_marked());
    // The host holds the frame at the height the panel needs, so the list grows upward and the line stays put.
    if (panel.offsetHeight !== told_height) tell_host({ kind: "resize", height: (told_height = panel.offsetHeight) });
  };

  // Keys typed here before `focused` wait behind the ones the host forwarded, which may still be on the port.
  // Without this, an Enter typed here can run before the last forwarded characters land.
  let typed_before_focused: string[] | undefined = [];
  // Set once the line ended. Keys that still reach this page wait here for the host's `drain`, which replays them in its frame.
  let late_keys: string[] | undefined;
  // Keys still waiting for `focused` came after the forwarded key that ended the line, so they are late too.
  const take_late_keys = () => {
    late_keys ??= typed_before_focused ?? [];
    typed_before_focused = undefined;
    return late_keys;
  };
  const end_line = (message: PageToHost) => {
    take_late_keys();
    tell_host(message);
  };

  // The help opens in a new tab, which takes the focus, so the line on this tab closes.
  const show_help = (command_id: string) => {
    void ask_background({ type: "open_help", command_id });
    close_sources();
    end_line({ kind: "close" });
  };

  // The rows change only when the model's patch arrives, so the answer carries just the refusal.
  const run_tab_rows_action = (effect: Extract<Effect, { kind: "tab_rows_action" }>) => {
    void ask_background<TabRowsActionAnswer | undefined>({ type: "tab_rows_action", action: effect.action, tab_ids: effect.tab_ids, ...(effect.cookie_store_id === undefined ? {} : { cookie_store_id: effect.cookie_store_id }) })
      .then(
        (answer) => session.set_message(answer ? answer.refusal : "could not change the tabs"),
        () => session.set_message("could not change the tabs"),
      )
      .finally(render);
  };

  const carry_out = (effect: Effect) => {
    if (effect.kind === "close") {
      close_sources();
      end_line({ kind: "close" });
    }
    else if (effect.kind === "find_commit") end_line({ kind: "find_commit" });
    else if (effect.kind === "help") show_help(effect.command_id);
    else if (effect.kind === "tab_rows_action") run_tab_rows_action(effect);
    else if (effect.kind === "submit") {
      close_sources();
      void ask_background({ type: "record_cmdline", text: effect.text });
      end_line({ kind: "submit", invocation: effect.invocation });
    } else render();
  };

  // Returns true when the keymap took the token, or the line has ended and keeps it for the host.
  const press = (token: string): boolean => {
    if (late_keys) {
      late_keys.push(token);
      return true;
    }
    // An arrow key or a click moves the caret with no input event, so the list would rank the old word.
    if (input.value === session.get_text()) session.set_caret(input.selectionStart ?? input.value.length);
    const outcome = matcher ? run_token(matcher, session, token) : run_token_without_keymap(session, token);
    if (outcome.kind === "effect") carry_out(outcome.effect);
    return outcome.kind === "effect";
  };

  // A key that reached the host script, not this page, so the line types it here.
  const press_forwarded = (token: string) => {
    if (press(token)) return;
    const end_of_text = input.value.length;
    const edited = edit_forwarded({ text: input.value, start: input.selectionStart ?? end_of_text, end: input.selectionEnd ?? end_of_text }, token);
    if (!edited) return;
    input.value = edited.text;
    input.setSelectionRange(edited.caret, edited.caret);
    session.edit(input.value, edited.caret);
    render();
  };

  // On the document, not the input: while focus moves into the frame, a key can land before the input has it.
  document.addEventListener("keydown", (event) => {
    const token = event.isTrusted && !event.isComposing ? event_to_token(event) : null;
    const waiting = late_keys ?? typed_before_focused;
    if (waiting) {
      if (token !== null) waiting.push(token);
      event.preventDefault();
    } else if (token !== null && press(token)) event.preventDefault();
  });
  // Non-passive, so the page behind the list never scrolls while the pointer is over it.
  const list_element = document.querySelector<HTMLElement>("#list")!;
  const wheel: Wheel_state = { remainder_px: 0 };
  list_element.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const row_height_px = (list_element.firstElementChild as HTMLElement | null)?.offsetHeight || FALLBACK_ROW_HEIGHT_PX;
      const rows = wheel_rows(wheel, event.deltaY, event.deltaMode, row_height_px);
      if (rows !== 0) list.scroll(rows);
    },
    { passive: false },
  );
  // A press on a row must not take the focus from the input, which would lose the caret.
  list_element.addEventListener("mousedown", (event) => event.preventDefault());
  list_element.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const help_id = target?.closest<HTMLElement>(".desertfox-cmdline-link")?.dataset.help;
    if (help_id !== undefined) return show_help(help_id);
    const index = target?.closest<HTMLElement>("[data-index]")?.dataset.index;
    if (index === undefined) return;
    session.pick(Number(index));
    render();
  });
  input.addEventListener("input", () => {
    session.edit(input.value, input.selectionStart ?? input.value.length);
    render();
  });

  host_port.onmessage = (event: MessageEvent) => {
    const message = unwrap<HostToPage>(event.data);
    if (message?.kind === "token") press_forwarded(message.token);
    else if (message?.kind === "check") tell_host({ kind: "here" });
    else if (message?.kind === "refocus") input.focus();
    else if (message?.kind === "headings") {
      headings_reply?.(message.items);
      headings_reply = undefined;
    } else if (message?.kind === "find_status") {
      session.set_status(message.text);
      render();
    }
    else if (message?.kind === "drain") {
      // Firefox sends this page its keys and its loss of focus in order. Every key that left for this page before the
      // focus moved has arrived by the blur, so the answer waits for it.
      const late = take_late_keys();
      const answer = () => tell_host({ kind: "drained", tokens: late });
      if (document.hasFocus()) window.addEventListener("blur", answer, { once: true });
      else answer();
    }
    else if (message?.kind === "focused" && typed_before_focused) {
      // Again now that the frame has focus. The first call ran while the host still held it.
      input.focus();
      const waiting = typed_before_focused;
      typed_before_focused = undefined;
      for (const token of waiting) press_forwarded(token);
    }
  };
  session.open(start.text);
  render();
  input.focus();
  for (const token of start.tokens) press_forwarded(token);
  tell_host({ kind: "opened" });
}

window.addEventListener("message", (event) => {
  const message = unwrap<HostToPage>(event.data);
  const port = event.ports[0];
  if (!host_port && message?.kind === "start" && port) void open_line(message, port);
});

// No autofocus anywhere: the frame would take the keys before the host has handed over the ones it kept, and the start message would wipe them.
say_ready();
