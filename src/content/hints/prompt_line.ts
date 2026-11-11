// The `prompt` action: the command line opens holding a command and the address of the picked element, for the user to edit.

import { element_address, NO_WEB_ADDRESS } from "./actions.ts";
import { single_quote } from "../../shared/registry/single_quote.ts";
import type { Refusal } from "./actions.ts";

// The line splits words on whitespace and reads quotes and backslashes. A leading dash would read as a flag and a leading @ as a context source.
const NEEDS_QUOTES = /[\s'"\\]|^[-@]/;

export const quote_for_line = (text: string): string => (NEEDS_QUOTES.test(text) ? single_quote(text) : text);

export const line_for = (command: string, address: string): string => `${command} ${quote_for_line(address)}`;

// The answer settles when the line closes, so a sequence resumes after Enter or Escape.
export function prompt_pick(target: Parameters<typeof element_address>[0], command: string, with_background: boolean, open_line_: (text: string) => Promise<unknown>): Refusal | Promise<unknown> {
  const address = element_address(target, with_background);
  return address === undefined ? NO_WEB_ADDRESS : open_line_(line_for(command, address));
}
