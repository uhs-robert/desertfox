import type { Invocation } from "../../shared/invocation.ts";

export type TextInput = { input_type: string; data: string | null; field: Element | null };

export type TextRecorderDeps = {
  is_secret: (field: Element | null) => boolean;
  take_entry: (field: Element | null) => Invocation | undefined;
  // Gets the steps of one finished insert session: the entry, if a command focused the field, then `text.insert`.
  record: (steps: Invocation[]) => void;
};

type Session = { field: Element | null; text: string; entry: Invocation | undefined };

// One insert session is the text typed in one field, from its first input event to a flush. The caller flushes on every event that ends it.
// The text comes from input events, not from key presses, so a pasted or autofilled run counts and a key the field ignored does not.
export function create_text_recorder(deps: TextRecorderDeps) {
  let session: Session | undefined;
  let replaying = false;

  function flush(): void {
    const ended = session;
    session = undefined;
    if (!ended || ended.text === "") return;
    deps.record([...(ended.entry ? [ended.entry] : []), { id: "text.insert", args: { text: ended.text } }]);
  }

  function on_input({ input_type, data, field }: TextInput): void {
    if (replaying) return;
    if (session && session.field !== field) flush();
    if (deps.is_secret(field)) return;
    session ??= { field, text: "", entry: deps.take_entry(field) };
    if (input_type === "insertText" || input_type === "insertFromPaste") session.text += data ?? "";
    else if (input_type === "insertLineBreak" || input_type === "insertParagraph") session.text += "\n";
    // Deleting text that was there before the session cannot be replayed, so only the session's own text shrinks.
    else if (input_type === "deleteContentBackward") session.text = [...session.text].slice(0, -1).join("");
  }

  // The replay's own input events must not record themselves, or a count would grow the text it repeats.
  function while_replaying(write: () => void): void {
    replaying = true;
    try {
      write();
    } finally {
      replaying = false;
    }
  }

  return { on_input, flush, while_replaying };
}
