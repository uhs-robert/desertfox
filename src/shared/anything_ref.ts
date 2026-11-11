// The reference a finder row carries to the `anything` command. The page puts it in the submitted query, so the handler acts on the row the list showed
// and never ranks again: a repeated address or title cannot pick the wrong row. Text typed without a row is a plain query.

// The param of the `anything` command that holds the query, or the reference of the highlighted row in its place.
export const FINDER_PARAM = "query";

export type AnythingRef =
  | { kind: "tab"; id: number }
  | { kind: "closed"; session_id: string }
  // A quickmark, bookmark or history row.
  | { kind: "page"; url: string }
  | { kind: "engine"; engine: string; query: string }
  // The last row: the whole query through the default engine, or as an address when it looks like one.
  | { kind: "web"; query: string };

// A control character no typed query starts with.
const REF_MARK = "\u0001";

export const encode_ref = (ref: AnythingRef): string => REF_MARK + JSON.stringify(ref);

export function decode_ref(text: string): AnythingRef | undefined {
  if (!text.startsWith(REF_MARK)) return undefined;
  try {
    const ref = JSON.parse(text.slice(REF_MARK.length)) as Record<string, unknown>;
    const is_text = (value: unknown): value is string => typeof value === "string";
    if (ref.kind === "tab" && Number.isInteger(ref.id)) return { kind: "tab", id: ref.id as number };
    if (ref.kind === "closed" && is_text(ref.session_id)) return { kind: "closed", session_id: ref.session_id };
    if (ref.kind === "page" && is_text(ref.url)) return { kind: "page", url: ref.url };
    if (ref.kind === "engine" && is_text(ref.engine) && is_text(ref.query)) return { kind: "engine", engine: ref.engine, query: ref.query };
    if (ref.kind === "web" && is_text(ref.query)) return { kind: "web", query: ref.query };
  } catch {
    // Not a reference: the text is a query.
  }
  return undefined;
}
