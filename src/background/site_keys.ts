// The answer to the help page's "Let this site keep some keys" write. The pure rows are in `shared/site/site_keys.ts`.

import { match_regex_source } from "../shared/match_pattern.ts";
import type { SiteKeysRequest, ToolbarAnswer } from "../shared/messages/page.ts";
import { pass_words } from "../shared/site/site_keys.ts";

export type SiteKeysDeps = {
  // Writes the change into settings.toml (`change_site_keys_in_file`) and gives back what became of the file as the end of the answer.
  // `unchanged`: a Remove found no row.
  change_site_keys: (pattern: string, keys: string | null) => Promise<{ note: string } | { unchanged: true }>;
};

// The form's one write. The request is checked here because a page script can send anything.
export async function answer_site_keys_request(request: SiteKeysRequest, deps: SiteKeysDeps): Promise<ToolbarAnswer> {
  if (typeof request.pattern !== "string" || match_regex_source([request.pattern]) === undefined) return { ok: false, message: "The site must be an address pattern such as *://*.example.com/*" };
  if (request.keys !== null) {
    const checked = typeof request.keys === "string" ? pass_words(request.keys) : { problem: "keys must be text or null" };
    if ("problem" in checked) return { ok: false, message: checked.problem };
  }
  try {
    const result = await deps.change_site_keys(request.pattern, request.keys);
    if ("unchanged" in result) return { ok: true, message: `No kept keys for ${request.pattern} to remove` };
    return { ok: true, message: `${request.keys === null ? "Keys no longer kept for" : "Keys kept for"} ${request.pattern}${result.note}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
