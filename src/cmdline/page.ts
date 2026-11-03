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

// Read once and cleared, so a page that navigates this frame away cannot read it from `window.name`.
const ticket = window.name;
window.name = "";
// The port from the host's `start`. Until it arrives there is nobody to tell.
let host_port: MessagePort | undefined;

// Only `ready` goes to the parent window, see `protocol.ts`.
const tell_host = (message: PageToHost) => host_port?.postMessage(wrap(message));
const say_ready = () => window.parent.postMessage(wrap<PageToHost>({ kind: "ready" }), "*");

const ask_background = <Answer>(message: ContentToBackground) => browser.runtime.sendMessage(message) as Promise<Answer>;

async function main(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>("#line")!;
  const note = document.querySelector<HTMLElement>("#note")!;

  const [stored, opened] = await Promise.all([
    browser.storage.local.get(COMPILED_KEYMAP_STORAGE_KEY),
    ask_background<CmdlineOpened | undefined>({ type: "open_cmdline", ticket }),
  ]);
  // A copy of this page that the host did not open: a site embedded it on its own. It stays silent.
  if (!opened) return;
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

  input.addEventListener("keydown", (event) => {
    const token = event.isTrusted && !event.isComposing ? event_to_token(event) : null;
    if (token !== null && press(token)) event.preventDefault();
  });
  input.addEventListener("input", () => {
    session.edit(input.value);
    render();
  });

  const take_token = (event: MessageEvent) => {
    const message = unwrap<HostToPage>(event.data);
    if (message?.kind === "token") press_forwarded(message.token);
  };

  // Page scripts can post here too. Only the host knows the ticket, and only the first `start` counts.
  window.addEventListener("message", (event) => {
    const message = unwrap<HostToPage>(event.data);
    const port = event.ports[0];
    const is_first_host_start = !host_port && message?.kind === "start" && message.ticket === ticket;
    if (!is_first_host_start || !port) return;
    host_port = port;
    host_port.onmessage = take_token;
    session.edit(message.text);
    render();
    input.focus();
    for (const token of message.tokens) press_forwarded(token);
  });

  // No autofocus anywhere: the frame would take the keys before the host has handed over the ones it kept, and the start message would wipe them.
  say_ready();
}

void main();
