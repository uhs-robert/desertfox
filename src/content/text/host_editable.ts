import type { PageHostApi } from "../bundle_host.ts";

// A bundle's own copy of editable.ts holds no per-site rules, so every field check in a bundle asks the frame's host.
export const is_editable_in_frame = (element: Element | null): boolean => (window as unknown as { desertfox_host: PageHostApi }).desertfox_host.is_editable_(element);
