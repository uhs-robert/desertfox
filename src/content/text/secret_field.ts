// The one test for a field whose text is never recorded. Recorders and register writes call it, so the rule has one home.
export const is_secret_field = (field: Element | null): boolean => field instanceof HTMLInputElement && field.type === "password";
