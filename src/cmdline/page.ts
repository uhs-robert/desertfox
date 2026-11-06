// The command line page, shown in an iframe by the `cmdline` bundle. It has its own matcher over the stored keymap,
// because the content script's keys cannot reach into the iframe. Enter parses the line with the shared grammar
// and hands the invocation to the host script, which runs it from the page's own frame.

import { create_matcher, event_to_token } from "../shared/keys/index.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import { check_args, parse_command_line } from "../shared/registry/index.ts";
import type { CmdlineOpened, CompleteItemsAnswer, ContentToBackground, HeadingItem, SetTabUnloadedAnswer } from "../shared/messages.ts";
import { create_live_source } from "./completion/live.ts";
import { create_completer, marks_of } from "./completion/sources.ts";
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
import { create_word_lookup } from "./word_lookup.ts";
import { follow_theme } from "../shared/theme/apply.ts";

// The port from the host's `start`. Until it arrives there is nobody to tell.
let host_port: MessagePort | undefined;

// Only `ready` goes to the parent window, see `protocol.ts`.
const tell_host = (message: PageToHost) => host_port?.postMessage(wrap(message));
const say_ready = () => window.parent.postMessage(wrap<PageToHost>({ kind: "ready" }), "*");

const ask_background = <Answer>(message: ContentToBackground) => browser.runtime.sendMessage(message) as Promise<Answer>;

type Start = Extract<HostToPage, { kind: "start" }>;

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
  // After the built-in styles, so the theme beats the hex defaults and user CSS beats the theme.
  follow_theme(".desertfox-cmdline");
  const user_style = document.createElement("style");
  user_style.textContent = opened.css;
  document.head.append(user_style);
  if (start.search) show_prompt(document.querySelector<HTMLElement>(".desertfox-cmdline-prompt")!, start.search === "forward" ? "/ " : "? ");
  else if (opened.prompt) show_prompt(document.querySelector<HTMLElement>(".desertfox-cmdline-prompt")!, opened.prompt);
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
  // Asks the background for tabs and bookmarks only when a subject needs them, and only here, after the ticket redeemed.
  const live = create_live_source({
    ask: (kind) => (kind === "headings" ? ask_headings() : ask_background<CompleteItemsAnswer | undefined>({ type: "complete_items", kind })),
    on_ready: () => {
      session.source_ready();
      render();
    },
  });
  const session: Session = create_session({
    search: start.search !== undefined,
    history: start.search ? [] : opened.history,
    parse: (text) => parse_command_line(lookup, text, opened.sources),
    has_help,
    command_id_of: (word) => lookup.find(word)?.id,
    complete: start.search ? undefined : create_completer(lookup, opened.commands, opened.command_aliases, opened.sources, opened_from, live),
    // Only a missing value is caught here. The router still checks everything else when it runs the command.
    precheck: (invocation) => {
      const command = lookup.find(invocation.id);
      const checked = command && check_args(command, invocation.args, opened.sources);
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
    const message = session.get_message();
    // The error colour is for errors only. Without one the note shows the usage or "no match".
    const shown = message ?? session.get_hint() ?? "";
    note.textContent = shown;
    note.hidden = shown === "";
    document.body.classList.toggle("desertfox-cmdline-error", message !== undefined);
    // A new ranking starts at the top, so leftover wheel pixels belong to the old one.
    if (session.get_rows() !== wheel_rows_drawn) wheel.remainder_px = 0;
    wheel_rows_drawn = session.get_rows();
    list.render(session.get_rows(), session.get_selected(), session.get_hint() === "loading");
    // The host holds the frame at the height the panel needs, so the list grows upward and the line stays put.
    if (panel.offsetHeight !== told_height) tell_host({ kind: "resize", height: (told_height = panel.offsetHeight) });
  };

  // The help opens in a new tab, which takes the focus, so the line on this tab closes.
  const show_help = (command_id: string) => {
    void ask_background({ type: "open_help", command_id });
    live.close();
    tell_host({ kind: "close" });
  };

  const flip_tab = (tab_id: number, unloaded: boolean) => {
    void ask_background<SetTabUnloadedAnswer | undefined>({ type: "set_tab_unloaded", tab_id, unloaded }).then(
      (answer) => {
        if (!answer) return session.set_message("could not change the tab");
        live.patch_tab(answer.item);
        session.patch_tab(marks_of(answer.item));
        session.set_message(answer.refusal ? `not ${unloaded ? "unloaded" : "loaded"}: ${answer.refusal}` : undefined);
      },
      () => session.set_message("could not change the tab"),
    ).finally(render);
  };

  const carry_out = (effect: Effect) => {
    if (effect.kind === "close") {
      live.close();
      tell_host({ kind: "close" });
    }
    else if (effect.kind === "find_commit") tell_host({ kind: "find_commit" });
    else if (effect.kind === "help") show_help(effect.command_id);
    else if (effect.kind === "set_tab_unloaded") flip_tab(effect.tab_id, effect.unloaded);
    else if (effect.kind === "submit") {
      live.close();
      void ask_background({ type: "record_cmdline", text: effect.text });
      tell_host({ kind: "submit", invocation: effect.invocation });
    } else render();
  };

  // Returns true when the keymap took the token.
  const press = (token: string): boolean => {
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

  // Keys typed here before `focused` wait behind the ones the host forwarded, which may still be on the port.
  // Without this, an Enter typed here can run before the last forwarded characters land.
  let typed_before_focused: string[] | undefined = [];
  // On the document, not the input: while focus moves into the frame, a key can land before the input has it.
  document.addEventListener("keydown", (event) => {
    const token = event.isTrusted && !event.isComposing ? event_to_token(event) : null;
    if (typed_before_focused) {
      if (token !== null) typed_before_focused.push(token);
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
