// A field seen as secret stays secret, because a "show password" toggle turns the same field into `type=text`.
const seen_secret = new WeakSet<Element>();

const SECRET_AUTOCOMPLETE = /(?:^|\s)(?:current-password|new-password|one-time-code)(?:\s|$)/;

// The one test for a field whose text is never recorded. Recorders and register writes call it, so the rule has one home.
export function is_secret_field(field: Element | null): boolean {
  if (!(field instanceof HTMLInputElement)) return false;
  if (field.type === "password" || SECRET_AUTOCOMPLETE.test(field.autocomplete ?? "")) seen_secret.add(field);
  return seen_secret.has(field);
}
