import { ignore_refusal } from "../shared/swallow.ts";
// The strip rule as the page and hints bundles read it: the background resolves the site's `strip_tracking` and the global list.

export async function read_strip_patterns(page_address: string): Promise<readonly string[]> {
  const patterns = await ignore_refusal(browser.runtime.sendMessage({ type: "read_strip_patterns", address: page_address }));
  return Array.isArray(patterns) ? patterns : [];
}
