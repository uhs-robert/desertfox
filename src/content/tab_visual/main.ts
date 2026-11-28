// The `tab_visual` bundle: the sink of tab range mode. The range itself is Firefox's tab selection, kept by the background (`tab.visual`). The sink exists so that the mode ends with the page: a tab switch or a navigation hides it, and `exit` then asks the background to clear the range.

import type { PageHostApi } from "../bundle_host.ts";
import { best_effort } from "../../shared/swallow.ts";

type TabVisualWindow = { desertfox_host?: PageHostApi; desertfox_tab_visual_ready?: true };
declare const browser: MessagingBrowser;

const tab_visual = window as unknown as TabVisualWindow;

function register(host: PageHostApi): void {
  host.register_handler_("tab.visual_enter", () => host.set_mode_("tab_visual"));
  // The background decides what `end` clears, whichever way the mode ended: after a tab switch it finds one tab selected and does nothing.
  const end_range = () => void best_effort(browser.runtime.sendMessage({ type: "run", invocations: [{ id: "tab.visual", args: { action: "end" } }], mode: "normal" }));
  host.register_sink_("tab_visual", { on_token_: () => "pass", exit: end_range });
}

const host = tab_visual.desertfox_host;
if (!tab_visual.desertfox_tab_visual_ready && host) {
  tab_visual.desertfox_tab_visual_ready = true;
  register(host);
}
