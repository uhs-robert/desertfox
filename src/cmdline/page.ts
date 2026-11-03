// The command line page, shown in an iframe by the `cmdline` bundle. It has its own matcher over the stored keymap,
// because the content script's keys cannot reach into the iframe. Enter parses the line with the shared grammar
// and hands the invocation to the host script, which runs it from the page's own frame.

import { create_matcher, event_to_token } from "../shared/keys/index.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import { parse_command_line } from "../shared/registry/index.ts";
import type { CmdlineOpened, ContentToBackground } from "../shared/messages.ts";
import { edit_forwarded, run_token, run_token_without_keymap } from "./key_input.ts";
import type { TokenMatcher } from "./key_input.ts";
import type { HostToPage, PageToHost } from "./protocol.ts";
import { unwrap, wrap } from "./protocol.ts";
import { create_session } from "./session.ts";
import type { Effect, Session } from "./session.ts";
import { create_word_lookup } from "./word_lookup.ts";

// The port from the host's `start`. Until it arrives there is nobody to tell.
let host_port: MessagePort | undefined;

// Only `ready` goes to the parent window, see `protocol.ts`.
const tell_host = (message: PageToHost) => host_port?.postMessage(wrap(message));
const say_ready = () => window.parent.postMessage(wrap<PageToHost>({ kind: "ready" }), "*");

const ask_background = <Answer>(message: ContentToBackground) => browser.runtime.sendMessage(message) as Promise<Answer>;

type Start = Extract<HostToPage, { kind: "start" }>;

// Page scripts can post a `start` too, to this frame or to a copy they embed. Only the background knows whether the
// ticket is live, so every `start` is tried and the first one it accepts wins.
async function open_line(start: Start, port: MessagePort): Promise<void> {
  const input = document.querySelector<HTMLInputElement>("#line")!;
  const note = document.querySelector<HTMLElement>("#note")!;

  const [stored, opened] = await Promise.all([
    browser.storage.local.get(COMPILED_KEYMAP_STORAGE_KEY),
    ask_background<CmdlineOpened | undefined>({ type: "open_cmdline", ticket: start.ticket }),
  ]);
  if (!opened || host_port) return;
  host_port = port;
  const lookup = create_word_lookup(opened.commands, opened.command_aliases);
  // After the built-in styles, so user CSS wins.
  const user_style = document.createElement("style");
  user_style.textContent = opened.css;
  document.head.append(user_style);
  const keymap = stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined;
  const matcher: TokenMatcher | undefined = keymap?.modes.cmdline ? create_matcher(keymap) : undefined;
  const session: Session = create_session({ history: opened.history, parse: (text) => parse_command_line(lookup, text, opened.sources) });

  const render = () => {
    if (input.value !== session.get_text()) input.value = session.get_text();
    const message = session.get_message();
    note.textContent = message ?? "";
    note.hidden = message === undefined;
    document.body.classList.toggle("oasisfox-cmdline-error", message !== undefined);
  };

  const carry_out = (effect: Effect) => {
    if (effect.kind === "close") tell_host({ kind: "close" });
    else if (effect.kind === "submit") {
      void ask_background({ type: "record_cmdline", text: effect.text });
      tell_host({ kind: "submit", invocation: effect.invocation });
    } else render();
  };

  // Returns true when the keymap took the token.
  const press = (token: string): boolean => {
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
    session.edit(input.value);
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
  input.addEventListener("input", () => {
    session.edit(input.value);
    render();
  });

  host_port.onmessage = (event: MessageEvent) => {
    const message = unwrap<HostToPage>(event.data);
    if (message?.kind === "token") press_forwarded(message.token);
    else if (message?.kind === "check") tell_host({ kind: "here" });
    else if (message?.kind === "focused" && typed_before_focused) {
      // Again now that the frame has focus. The first call ran while the host still held it.
      input.focus();
      const waiting = typed_before_focused;
      typed_before_focused = undefined;
      for (const token of waiting) press_forwarded(token);
    }
  };
  session.edit(start.text);
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
