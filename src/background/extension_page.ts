// Kept apart from settings_message.ts so the bundle loader can use it without importing the command modules.

// Only a top-level extension page may ask. `cmdline.html` is web-accessible, so a site can embed it in a frame, and a content script runs under the site's address.
export function is_extension_page(sender: { id?: string | undefined; url?: string | undefined; frameId?: number | undefined; tab?: { url?: string | undefined } | undefined }, extension_id: string, origin: string): boolean {
  const under_origin = (url: string | undefined) => url !== undefined && url.startsWith(origin);
  return sender.id === extension_id && under_origin(sender.url) && (sender.frameId ?? 0) === 0 && (sender.tab === undefined || under_origin(sender.tab.url));
}
