// Support for `config.reload`: the marker before the reload and the repair of open tabs after it.

import { REINJECT_REPORT_STORAGE_KEY, RELOAD_PENDING_STORAGE_KEY } from "./storage_keys.ts";

export async function mark_reload_pending(): Promise<void> {
  await browser.storage.local.set({ [RELOAD_PENDING_STORAGE_KEY]: Date.now() });
}

export type ReinjectReport = {
  at: number;
  // Tabs whose content script answered the ping, so Firefox had already loaded it again.
  already_loaded: number;
  // Tabs where this code injected `content.js`.
  injected: number;
  // Tabs where the injection failed, for example AMO or the PDF viewer.
  failed: number;
};

export type ReinjectDeps = {
  list_tabs: () => Promise<{ tab_id: number; url: string | undefined }[]>;
  ping: (tab_id: number) => Promise<boolean>;
  inject: (tab_id: number) => Promise<void>;
};

// Only these schemes match `<all_urls>` in the manifest.
const INJECTABLE_URL = /^(https?|file|ftp):/;

export async function reinject_missing_content_scripts(deps: ReinjectDeps, now = Date.now()): Promise<ReinjectReport> {
  const report: ReinjectReport = { at: now, already_loaded: 0, injected: 0, failed: 0 };
  for (const tab of await deps.list_tabs()) {
    if (tab.url === undefined || !INJECTABLE_URL.test(tab.url)) continue;
    if (await deps.ping(tab.tab_id)) {
      report.already_loaded++;
      continue;
    }
    try {
      await deps.inject(tab.tab_id);
      report.injected++;
    } catch {
      report.failed++;
    }
  }
  return report;
}

// Runs at startup. A start without the marker is a browser start or an install, where Firefox loads the scripts itself.
export async function repair_tabs_after_reload(deps: ReinjectDeps): Promise<ReinjectReport | undefined> {
  const stored = await browser.storage.local.get(RELOAD_PENDING_STORAGE_KEY);
  if (stored[RELOAD_PENDING_STORAGE_KEY] === undefined) return undefined;
  await browser.storage.local.remove(RELOAD_PENDING_STORAGE_KEY);
  const report = await reinject_missing_content_scripts(deps);
  await browser.storage.local.set({ [REINJECT_REPORT_STORAGE_KEY]: report });
  console.info("desertfox: tabs after reload", report);
  return report;
}
