// The allow list of source files that ship in content.js, each with the admission clause of AGENTS.md "Content script size" that lets it in.
// A new file in content.js needs a line here. Where no clause fits, the file moves to an on-demand bundle instead.
export const ADMISSION_CLAUSES = ["before_first_key", "scrolling", "bundle_host", "navigation"] as const;
export type AdmissionClause = (typeof ADMISSION_CLAUSES)[number];

const before_first_key = "before_first_key";
const scrolling = "scrolling";
const bundle_host = "bundle_host";
const navigation = "navigation";

export const CONTENT_SOURCES: Record<string, AdmissionClause> = {
  "src/content/ask_keymap.ts": before_first_key,
  "src/content/badge_hosts.ts": bundle_host,
  // Gates whether the ui bundle loads at all.
  "src/content/badge_state.ts": bundle_host,
  "src/content/bundle_host.ts": bundle_host,
  "src/content/bundles.ts": bundle_host,
  "src/content/cancelled_keys.ts": before_first_key,
  "src/content/editable.ts": before_first_key,
  "src/content/handler_map.ts": before_first_key,
  "src/content/handlers/focus.ts": navigation,
  "src/content/handlers/mode.ts": before_first_key,
  "src/content/handlers/page.ts": before_first_key,
  "src/content/handlers/scroll.ts": scrolling,
  "src/content/handlers/stop.ts": navigation,
  "src/content/hidden_frame.ts": before_first_key,
  "src/content/hints/hint_keys.ts": before_first_key,
  "src/content/invocation_args.ts": before_first_key,
  "src/content/key_flow.ts": before_first_key,
  "src/content/leaf_for_page.ts": before_first_key,
  "src/content/main.ts": before_first_key,
  "src/content/mode_report.ts": before_first_key,
  "src/content/mode_state.ts": before_first_key,
  "src/content/page_mode.ts": before_first_key,
  "src/content/replay_key.ts": before_first_key,
  "src/content/run_content.ts": before_first_key,
  "src/content/run_leaf.ts": before_first_key,
  "src/content/scroll_box.ts": scrolling,
  "src/content/scroll_target.ts": scrolling,
  "src/content/shadow.ts": before_first_key,
  "src/content/shown.ts": before_first_key,
  "src/content/site_mode.ts": before_first_key,
  "src/content/site_rule.ts": before_first_key,
  "src/content/smooth_behavior.ts": scrolling,
  "src/content/text/field_text.ts": before_first_key,
  "src/content/ui_proxy.ts": bundle_host,
  "src/content/whichkey/gate.ts": before_first_key,
  "src/shared/bundles.ts": bundle_host,
  "src/shared/command.ts": before_first_key,
  "src/shared/default_settings.ts": before_first_key,
  "src/shared/keys/matcher.ts": before_first_key,
  "src/shared/keys/token.ts": before_first_key,
  "src/shared/prefix_tree.ts": before_first_key,
  "src/shared/register_names.ts": before_first_key,
  "src/shared/swallow.ts": before_first_key,
};
