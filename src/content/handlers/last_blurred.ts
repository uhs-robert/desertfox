// The element the last blur took focus from, kept so scroll.align can still find the field the user left.
// Apart from page.ts so the bundle host can read it without importing the bundle host's own users.

let last_blurred: HTMLElement | undefined;

export const last_blurred_element = () => last_blurred;
export const remember_blurred = (element: HTMLElement) => void (last_blurred = element);
