// What the host script (in the page) and the command line page (in the iframe) send each other.
// Types only, so the host bundle imports no page code.
//
// Page scripts share the window with the host script, so they see and can forge anything posted on it. Only `ready`
// (no data) and `start` (sent to the extension origin) use the window. `start` carries the end of a `MessageChannel`,
// and everything after it travels over that port, which page scripts never hold.

import type { Invocation } from "../shared/invocation.ts";

export type HostToPage =
  // Sent once the page said it is ready, with the port in its transfer list. The page trades `ticket` with the
  // background for its data, so a forged `start` gets nothing. `tokens` are the keys typed while the page loaded, in order.
  // `mode` is the mode the line was opened from, which decides the commands the list offers.
  // `search` makes the line a page search: it types no command, and the host reads each edit.
  | { kind: "start"; ticket: string; text: string; tokens: string[]; mode: string; search?: "forward" | "backward" | undefined }
  // A key that reached the host script instead of the page, for example after a click on the page.
  | { kind: "token"; token: string }
  // Sent once the host moved focus into the frame, after every key it forwarded. Later keys reach the page directly.
  | { kind: "focused" }
  // Sent after the frame loaded. A page that is still ours answers `here`.
  | { kind: "check" }
  // The line to show under a search line, such as "3 of 17". Empty clears it.
  | { kind: "find_status"; text: string };

export type PageToHost =
  | { kind: "ready" }
  // The ticket was good and the line is set up, so the host may move focus into the frame.
  | { kind: "opened" }
  | { kind: "here" }
  | { kind: "close" }
  // The height in pixels the frame needs for the list, the note and the line.
  | { kind: "resize"; height: number }
  // The text of a search line, sent after each edit.
  | { kind: "find_text"; text: string }
  // Enter on a search line.
  | { kind: "find_commit" }
  | { kind: "submit"; invocation: Invocation };

export const MESSAGE_MARK = "oasisfox_cmdline";

export type Envelope<Message> = { [MESSAGE_MARK]: Message };

export const wrap = <Message>(message: Message): Envelope<Message> => ({ [MESSAGE_MARK]: message });

export function unwrap<Message>(data: unknown): Message | undefined {
  return typeof data === "object" && data !== null && MESSAGE_MARK in data ? ((data as Envelope<Message>)[MESSAGE_MARK]) : undefined;
}
