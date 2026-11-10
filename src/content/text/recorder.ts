import type { Invocation } from "../../shared/invocation.ts";

export type TextRecorderDeps = {
  is_secret: (field: Element | null) => boolean;
  take_entry: (field: Element | null) => Invocation | undefined;
  read_text: (field: Element) => string;
  // Gets the steps of one finished insert session: the entry, if a command focused the field, then `text.insert`.
  record: (steps: Invocation[]) => void;
};

type Session = { field: Element; before: string; entry: Invocation | undefined };

// What the edit put in, from the common prefix and suffix of the field's text before and after. A deletion puts in nothing.
// Comparing the text, not modelling each input event, covers word and forward delete, a selection replaced, a paste, IME and autocorrect with one rule.
// One contiguous edit is the model: text between two edits far apart in the field comes along with the second.
export function inserted_text(before: string, after: string): string {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  return after.slice(prefix, after.length - suffix);
}

// One insert session is the edits made in one field, from the text before its first edit to a flush. The caller flushes on every event that ends it.
export function create_text_recorder(deps: TextRecorderDeps) {
  let session: Session | undefined;
  let replaying = false;

  function flush(): void {
    const ended = session;
    session = undefined;
    if (!ended || deps.is_secret(ended.field)) return;
    const text = inserted_text(ended.before, deps.read_text(ended.field));
    if (text !== "") deps.record([...(ended.entry ? [ended.entry] : []), { id: "text.insert", args: { text } }]);
  }

  // `before` is the field's text before the edit that fired this call.
  function on_input(field: Element, before: string): void {
    if (replaying) return;
    if (session && session.field !== field) flush();
    if (deps.is_secret(field)) return;
    session ??= { field, before, entry: deps.take_entry(field) };
  }

  // The replay's own input events must not start a session, or a count would grow the text it repeats.
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
