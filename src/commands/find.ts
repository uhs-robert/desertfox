import { NEEDS_MODULE, browser_module_call } from "../background/browser_module_call.ts";
import type { CallResult } from "../background/browser_module_call.ts";
import { show_toast_on_tab } from "../background/browser_deps.ts";
import { cleaned_module_selection } from "../background/selection_ask.ts";
import { MAX_FIND_CHARS } from "../shared/browser_module_protocol.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import type { CommandContext, ParamDef } from "../shared/command.ts";
import { define } from "../shared/registry/builtin.ts";
import { ignore_refusal, refused_as } from "../shared/swallow.ts";

define("find.open", {
  name: "find",
  completion: "hidden",
  modes: ["normal", "caret", "visual", "visual_line", "item"],
  label: "Find",
  intent: "Search the page text as you type. Enter keeps the match. Escape clears the highlights and keeps the search and the current match as your position. The text is a regular expression, and a capital letter makes it match case. In caret mode the caret goes to the match. In visual mode the caret end goes to the match and the anchor stays. With `--word` there is no line: it searches the word under the caret, or the selected text in visual mode.",
  params: [{ name: "direction", type: "enum", values: ["forward", "backward"], default: "forward", value_labels: { backward: "backward" }, description: { backward: "Search up the page, and let n go up." } },
    { name: "source", type: "enum", values: ["typed", "word"], default: "typed", value_labels: { word: "word" }, description: { word: "Search the word or selection at the caret." } },
  ],
  bridge: false,
  runs_in: "content",
  repeatable: false,
  bundle: "caret",
});

define("find.next", {
  completion: "hidden",
  modes: ["normal", "caret", "visual", "visual_line", "item"],
  label: "Next match",
  intent: "Go to the next match of the last search. It goes the way the search was started. In caret mode the caret goes to the match. In visual mode the caret end goes to the match and the anchor stays.",
  bridge: false,
  runs_in: "content",
  bundle: "caret",
  jumps: true,
});

define("find.prev", {
  completion: "hidden",
  modes: ["normal", "caret", "visual", "visual_line", "item"],
  label: "Previous match",
  intent: "Go to the previous match of the last search. It goes against the way the search was started. In caret mode the caret goes to the match. In visual mode the caret end goes to the match and the anchor stays.",
  bridge: false,
  runs_in: "content",
  bundle: "caret",
  jumps: true,
});

// Find on a page the page code does not serve (see `LOCKED_VARIANTS` in shared/browser_module_scope.ts). The text goes through the browser module to Firefox's Finder, which matches plain text: no pattern, no smart case, no incremental highlight.
const FIND_TEXT_PATTERN = "^[^\\x00-\\x1f\\x7f-\\x9f\\xad\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff]{1,256}$";
const FIND_DIRECTIONS = ["forward", "backward"] as const;
type FindDirection = (typeof FIND_DIRECTIONS)[number];
const SHOWN_TEXT_CHARS = 40;
export const FIND_PRIVATE_REFUSAL = "Find is off in private tabs";
export const FIND_NEEDS_NEWER_MODULE = "Find needs a newer browser module. Run its install script again";

// The Finder's `nsITypeAheadFind` codes.
const FINDER_NOT_FOUND = 1;
const FINDER_WRAPPED = 2;

export type FindReply = { result: number; current: number; total: number; limit: number };

// The module's reply, foreign input: whole numbers in the fields this reads, and anything else is no reply.
export function find_reply_of(value: string | undefined): FindReply | undefined {
  let reply: unknown;
  try {
    reply = JSON.parse(value ?? "");
  } catch {
    return undefined;
  }
  const { result, current, total, limit } = (typeof reply === "object" && reply !== null ? reply : {}) as Record<string, unknown>;
  const whole = (item: unknown): item is number => typeof item === "number" && Number.isSafeInteger(item);
  return whole(result) && whole(current) && whole(total) && whole(limit) ? { result, current, total, limit } : undefined;
}

// The toast of one find: the place among the matches, or that there is none. A count the Finder did not give leaves the plain word.
// A total at the Finder's limit stands for "that many or more". The in-process Finder reports it as -1.
export function find_toast_of(reply: FindReply, text: string): { message: string; kind: "info" | "warning" } {
  if (reply.result === FINDER_NOT_FOUND) return { message: text === "" ? "No match" : `No match for ${JSON.stringify([...text].slice(0, SHOWN_TEXT_CHARS).join(""))}`, kind: "warning" };
  const wrapped = reply.result === FINDER_WRAPPED ? " (wrapped)" : "";
  if (reply.current < 1 || reply.limit < 1) return { message: `Found${wrapped}`, kind: "info" };
  const capped = reply.total < 0 || reply.total >= reply.limit;
  return { message: `${reply.current}/${capped ? reply.limit : reply.total}${capped ? "+" : ""}${wrapped}`, kind: "info" };
}

export type FindPageDeps = {
  is_private: (ctx: CommandContext) => Promise<boolean>;
  // The command line over the tab as a find line, or false when no panel opened.
  open_find_line: (tab_id: number, direction: FindDirection) => Promise<boolean>;
  call: (kind: string, args: Record<string, number | string>) => Promise<CallResult>;
  // The text selected on a parent-process about: page, or undefined where the module cannot read one.
  read_selection: (tab_id: number) => Promise<string | undefined>;
  toast: (ctx: CommandContext, message: string, kind: "info" | "warning") => Promise<void>;
};

export function make_find_page_handlers(deps: FindPageDeps) {
  const tab_of = (ctx: CommandContext): number => {
    if (ctx.tab_id === undefined) throw new RuntimeRefusal("No page to search");
    return ctx.tab_id;
  };
  const refusal_of = (error: string): RuntimeRefusal => {
    if (error === NEEDS_MODULE) return new RuntimeRefusal(`Find on this page ${NEEDS_MODULE.toLowerCase()}`);
    // A module before find refuses the kind, or an arg of it, with the core's fixed words.
    return new RuntimeRefusal(/allow list|has the wrong shape/.test(error) ? FIND_NEEDS_NEWER_MODULE : error);
  };
  const show = async (ctx: CommandContext, answer: CallResult, text: string): Promise<void> => {
    if (!answer.ok) throw refusal_of(answer.error);
    const reply = find_reply_of(answer.value);
    if (!reply) throw new RuntimeRefusal("The browser module gave no answer to the find");
    const toast = find_toast_of(reply, text);
    await deps.toast(ctx, toast.message, toast.kind);
  };
  const text_search = async (ctx: CommandContext, text: string, direction: FindDirection): Promise<void> => {
    const tab_id = tab_of(ctx);
    if (await deps.is_private(ctx)) throw new RuntimeRefusal(FIND_PRIVATE_REFUSAL);
    await show(ctx, await deps.call("find.search", { tab_id, text, backwards: direction === "backward" ? 1 : 0 }), text);
  };
  return {
    // `/` and `?` open the find line. `*` and `#` search the selected text at once.
    open: async (ctx: CommandContext, args: { direction: FindDirection; source: "typed" | "word" }): Promise<void> => {
      const tab_id = tab_of(ctx);
      if (await deps.is_private(ctx)) throw new RuntimeRefusal(FIND_PRIVATE_REFUSAL);
      if (args.source === "typed") {
        if (!(await deps.open_find_line(tab_id, args.direction))) throw new RuntimeRefusal("The find line needs the browser module's command line panel");
        return;
      }
      const selected = (await deps.read_selection(tab_id))?.trim().replace(/\s+/g, " ");
      if (selected === undefined) throw new RuntimeRefusal("Only about: pages the browser module can read give a word to search for");
      if (selected === "") throw new RuntimeRefusal("Select a word first");
      await text_search(ctx, [...selected].slice(0, MAX_FIND_CHARS).join(""), args.direction);
    },
    text: (ctx: CommandContext, args: { text: string; direction: FindDirection }): Promise<void> => text_search(ctx, args.text, args.direction),
    again: async (ctx: CommandContext, reverse: boolean): Promise<void> => {
      const tab_id = tab_of(ctx);
      if (await deps.is_private(ctx)) throw new RuntimeRefusal(FIND_PRIVATE_REFUSAL);
      await show(ctx, await deps.call("find.again", { tab_id, reverse: reverse ? 1 : 0 }), "");
    },
  };
}

// `main.ts` wires the panel once it has built it, as it does for the tab insert hold.
let open_find_line: FindPageDeps["open_find_line"] | undefined;
export const wire_find_line = (open: FindPageDeps["open_find_line"]): void => void (open_find_line = open);
export const FIND_PANEL_MODES: Record<FindDirection, string> = { forward: "find_forward", backward: "find_backward" };

const find_page = make_find_page_handlers({
  is_private: async (ctx) => ctx.tab_id !== undefined && (await ignore_refusal(browser.tabs.get(ctx.tab_id)))?.incognito === true,
  open_find_line: async (tab_id, direction) => (open_find_line ? refused_as(open_find_line(tab_id, direction), false) : false),
  call: (kind, args) => browser_module_call.call(kind, args),
  read_selection: async (tab_id) => {
    const read = await browser_module_call.call("selection.read", { tab_id });
    return read.ok ? cleaned_module_selection(read.value ?? "") : undefined;
  },
  toast: (ctx, message, kind) => show_toast_on_tab(ctx, "find_page", message, kind),
});

const FIND_DIRECTION_PARAM = { name: "direction", type: "enum", values: FIND_DIRECTIONS, default: "forward", value_labels: { backward: "backward" }, description: { backward: "Search up the page, and let n go up." } } as const satisfies ParamDef;

define("find.page", {
  completion: "hidden",
  label: "Find",
  intent: "Find text on a page with no page code. The line asks for plain text, and on Enter Firefox's Finder selects the match. A toast gives its place among the matches. With `--word` it searches the selected text of an about: page.",
  params: [FIND_DIRECTION_PARAM, { name: "source", type: "enum", values: ["typed", "word"], default: "typed", value_labels: { word: "word" }, description: { word: "Search the selected text." } }],
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => find_page.open(ctx, args),
});

define("find.page_text", {
  completion: "hidden",
  label: "Find text",
  intent: "Search a page with no page code. The find line runs it on Enter.",
  params: [{ name: "text", type: "string", pattern: FIND_TEXT_PATTERN, description: "Search for this text." }, FIND_DIRECTION_PARAM],
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => find_page.text(ctx, args),
});

define("find.page_next", {
  completion: "hidden",
  label: "Next match",
  intent: "Go to the next match on a page with no page code. It goes the way the search was started.",
  bridge: false,
  runs_in: "background",
  run: (ctx) => find_page.again(ctx, false),
});

define("find.page_prev", {
  completion: "hidden",
  label: "Previous match",
  intent: "Go to the previous match on a page with no page code. It goes against the way the search was started.",
  bridge: false,
  runs_in: "background",
  run: (ctx) => find_page.again(ctx, true),
});
