import type { AnswerOf, RequestOf, ToBackground } from "../shared/messages/map.ts";

type Sender = browser.runtime.MessageSender;

// Where a message came from, for a handler that needs the tab. `sender` is the whole sender, for the fields the handler reads besides these.
export type Frame = { tab_id: number; tab: browser.tabs.Tab; frame_id: number; sender: Sender };
export type TabFrame = { tab_id: number; tab: browser.tabs.Tab; frame_id: number | undefined; sender: Sender };

// A handler answers with a promise, or with nothing when the answer type allows `undefined`.
type Answered<A> = Promise<A | (undefined extends A ? void : never)> | (undefined extends A ? undefined | void : never);

// `from` says who may send the message. A guard that fails never runs the handler:
// - page: an extension page only. Any other sender gets `refused`, in the shape of the answer.
// - frame: a frame of a tab. Without a tab id or frame id the message gets no answer.
// - tab: a tab. Without a tab id the message gets no answer.
// - any: every sender. The handler checks what it needs.
export type Handler<K extends keyof ToBackground, Q = RequestOf<ToBackground, K>, A = AnswerOf<ToBackground, K>> =
  | { from: "page"; refused: A; run: (request: Q, sender: Sender) => Answered<A> }
  | { from: "frame"; run: (request: Q, at: Frame) => Answered<A> }
  | { from: "tab"; run: (request: Q, at: TabFrame) => Answered<A> }
  | { from: "any"; run: (request: Q, sender: Sender) => Answered<A> };

export type Handlers<K extends keyof ToBackground> = { [P in K]: Handler<P> };

export const page_refusal = (what: string) => ({ ok: false as const, message: `only the extension's own pages may ${what}` });

// Pure: the sender test comes in, so a test drives every guard. A type no handler owns gets no answer: on the help and newtab pages other listeners hear the same message, and the answer of one of them is the one the sender gets.
export function dispatch(handlers: Handlers<keyof ToBackground>, is_own_page: (sender: Sender) => boolean) {
  return (message: unknown, sender: Sender): Promise<unknown> | undefined | void => {
    const type = (message as { type?: unknown } | null | undefined)?.type;
    if (typeof type !== "string" || !Object.hasOwn(handlers, type)) return undefined;
    // The table maps each type to its own request type, which one lookup by a runtime string cannot express.
    const handler = handlers[type as keyof ToBackground] as Handler<keyof ToBackground, never, unknown>;
    if (handler.from === "page") return is_own_page(sender) ? handler.run(message as never, sender) : Promise.resolve(handler.refused);
    if (handler.from === "any") return handler.run(message as never, sender);
    const { tab } = sender;
    if (tab?.id === undefined) return undefined;
    if (handler.from === "tab") return handler.run(message as never, { tab_id: tab.id, tab, frame_id: sender.frameId, sender });
    return sender.frameId === undefined ? undefined : handler.run(message as never, { tab_id: tab.id, tab, frame_id: sender.frameId, sender });
  };
}
