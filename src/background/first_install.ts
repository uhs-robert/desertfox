// Opens the Quick Start page once, on the first install. An update never opens it.

import { HELP_PAGE_FILE, PAGES } from "../help/route.ts";

const QUICK_START_HASH = PAGES.find((page) => page.id === "quick-start")!.hash;

export type FirstInstallDeps = {
  // The reason `runtime.onInstalled` gives: "install", "update", "browser_update" and so on.
  reason: string;
  // Absent or true opens the page. Read after the config loads, so a managed config can turn it off.
  open_on_install: () => Promise<boolean>;
  open_tab: (url: string) => Promise<unknown>;
};

export async function open_quick_start_on_install(deps: FirstInstallDeps, page_url: (file: string) => string): Promise<boolean> {
  if (deps.reason !== "install" || !(await deps.open_on_install())) return false;
  await deps.open_tab(`${page_url(HELP_PAGE_FILE)}${QUICK_START_HASH}`);
  return true;
}
