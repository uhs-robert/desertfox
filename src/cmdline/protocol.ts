// What the host script (in the page) and the command line page (in the iframe) send each other with `postMessage`.
// Types only, so the host bundle imports no page code.

import type { Invocation } from "../shared/invocation.ts";

export type HostToPage =
  // Sent once the page said it is ready. `tokens` are the keys typed while the page loaded, in order.
  | { kind: "start"; text: string; tokens: string[] }
  // A key that reached the host script instead of the page, for example after a click on the page.
  | { kind: "token"; token: string };

export type PageToHost = { kind: "ready" } | { kind: "close" } | { kind: "submit"; invocation: Invocation };

export const MESSAGE_MARK = "oasisfox_cmdline";

export type Envelope<Message> = { [MESSAGE_MARK]: Message };

export const wrap = <Message>(message: Message): Envelope<Message> => ({ [MESSAGE_MARK]: message });

export function unwrap<Message>(data: unknown): Message | undefined {
  return typeof data === "object" && data !== null && MESSAGE_MARK in data ? ((data as Envelope<Message>)[MESSAGE_MARK]) : undefined;
}
