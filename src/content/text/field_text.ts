// What a field holds now: `value` for an input or a textarea, the rendered text for an editable element.
export const read_field_text = (field: Element): string => (field as HTMLInputElement).value ?? (field as HTMLElement).innerText ?? "";
