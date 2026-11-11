// A field seen as secret stays secret, because a "show password" toggle turns the same field into `type=text`.
const seen_secret = new WeakSet<Element>();

const SECRET_AUTOCOMPLETE = /(?:^|\s)(?:current-password|new-password|one-time-code)(?:\s|$)/;

// The one test for a field whose text is never recorded. Recorders and register writes call it, so the rule has one home.
// `type` and `autocomplete` default to the field's own now. A caller that read them earlier passes them, for a field that changed since.
export function is_secret_field(field: Element | null, type = (field as HTMLInputElement | null)?.type, autocomplete: string | undefined = (field as HTMLInputElement | null)?.autocomplete): boolean {
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return false;
  if (type === "password" || SECRET_AUTOCOMPLETE.test(autocomplete ?? "")) seen_secret.add(field);
  return seen_secret.has(field);
}
