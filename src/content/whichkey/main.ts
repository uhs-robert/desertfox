// The `which-key` bundle: registers one handler. With a prefix it shows the keys that can follow, without one it hides the panel.

import type { BundleHostApi } from "../bundle_host.ts";
import type { PendingPrefix } from "../key_flow.ts";
import type { ListKeys, WhichKeyRow } from "../../shared/messages.ts";
import { hide_panel, show_panel } from "./panel.ts";

type WhichKeyWindow = { oasisfox_host: BundleHostApi; oasisfox_whichkey_ready?: true };
const page = window as unknown as WhichKeyWindow;

type ShowArgs = { prefix?: PendingPrefix; is_current: () => boolean };

// The modes whose keys are a keymap worth listing. The check sits here and not in content.js, which has no spare bytes.
const MODES_WITH_PANEL: readonly string[] = ["normal", "caret", "visual"];

async function show(prefix: PendingPrefix, is_current: () => boolean): Promise<void> {
  if (!MODES_WITH_PANEL.includes(prefix.mode)) return;
  const request: ListKeys = { type: "list_keys", mode: prefix.mode, prefix: prefix.typed };
  const rows = (await browser.runtime.sendMessage(request)) as WhichKeyRow[];
  // The next key may have arrived while the background answered.
  if (is_current() && rows.length > 0) show_panel(rows);
}

// A second run would register a second copy of the handler.
if (!page.oasisfox_whichkey_ready) {
  page.oasisfox_whichkey_ready = true;
  page.oasisfox_host.register_handler("whichkey", (args) => {
    const { prefix, is_current } = args as ShowArgs;
    if (!prefix) return hide_panel();
    void show(prefix, is_current).catch(() => undefined);
  });
}
