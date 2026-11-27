// Opens a privileged Firefox page (about:preferences and the like), which no extension API can open. The routes, in order: the browser module, the native host, then the clipboard for the user to paste into the address bar.

import { NEEDS_MODULE } from "../background/browser_module_call.ts";
import type { CallResult } from "../background/browser_module_call.ts";
import { NativeHostError } from "../background/native_client.ts";
import { EXTENSION_TO_MODULE_KINDS, wrong_shape_refusal } from "../shared/browser_module_protocol.ts";
import type { FIREFOX_PAGE_WHERE } from "../shared/browser_module_protocol.ts";
import { FIREFOX_PAGE_ADDRESSES, has_address, MODULE_FIREFOX_PAGES } from "../shared/firefox_pages.ts";
import type { FirefoxPage } from "../shared/firefox_pages.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import type { CommandContext } from "../shared/command.ts";

export const HOST_PAGE_NOTICE = "The native host or the browser module opens these pages in one key. Run :native.install for the host's install steps.";

export type FirefoxPageWhere = (typeof FIREFOX_PAGE_WHERE)[number];
export type FirefoxPageArgs = { page: FirefoxPage; where: FirefoxPageWhere };

export const FIREFOX_PAGE_OPEN_KIND = "firefox_page.open";

export type FirefoxPageDeps = {
  // Whether the module's hello says it opens Firefox pages. An older module never gets the request.
  module_opens_pages: () => Promise<boolean>;
  module_open: (args: { page: FirefoxPage; where: FirefoxPageWhere; tab_id?: number }) => Promise<CallResult>;
  open_page: (page: FirefoxPage) => Promise<void>;
  write_clipboard: (text: string) => Promise<void>;
  // Whether a no-host message already carried HOST_PAGE_NOTICE. Stored, so the notice shows once per profile.
  notice_shown: () => Promise<boolean>;
  mark_notice_shown: () => Promise<void>;
  toast: (ctx: CommandContext, message: string) => Promise<void>;
};

// A missing permission is a missing host from the user's side: the same install page fixes both.
const NO_HOST_FAILURES: ReadonlySet<string> = new Set(["host_missing", "no_permission"]);

// The module answers that it cannot take the request at all: it is gone, or it is older than a value of the request. Only then does the host try. Any other refusal (the rate limit, a tab that moved) stands, because the host would open the page in another window and step around the check.
const MODULE_CANNOT: ReadonlySet<string> = new Set([NEEDS_MODULE, ...Object.keys(EXTENSION_TO_MODULE_KINDS[FIREFOX_PAGE_OPEN_KIND]!.args).map((arg) => wrong_shape_refusal(FIREFOX_PAGE_OPEN_KIND, arg))]);

const takes_module_route = (page: FirefoxPage): boolean => MODULE_FIREFOX_PAGES.includes(page);

export function make_open_firefox_page_handler(deps: FirefoxPageDeps) {
  return async (ctx: CommandContext, args: FirefoxPageArgs): Promise<void> => {
    const { page, where } = args;
    if (takes_module_route(page) && (await deps.module_opens_pages())) {
      const result = await deps.module_open({ page, where, ...(ctx.tab_id !== undefined && { tab_id: ctx.tab_id }) });
      if (result.ok) return;
      if (!MODULE_CANNOT.has(result.error)) throw new RuntimeRefusal(result.error);
    }
    // The host and the clipboard can only add a tab.
    if (where === "here") throw new RuntimeRefusal(`${NEEDS_MODULE} to open a Firefox page in this tab`);
    if (!has_address(page)) throw new RuntimeRefusal(`${NEEDS_MODULE} to open ${page}, which has no address to paste`);
    try {
      await deps.open_page(page);
      return;
    } catch (error) {
      if (!(error instanceof NativeHostError)) throw error;
      if (!NO_HOST_FAILURES.has(error.failure)) throw new RuntimeRefusal(error.message);
    }
    const address = FIREFOX_PAGE_ADDRESSES[page];
    try {
      await deps.write_clipboard(address);
    } catch {
      throw new RuntimeRefusal(`Could not copy ${address}. Type it into the address bar.`);
    }
    const message = `Copied ${address}. Press Ctrl+L, then paste.`;
    if (await deps.notice_shown()) return deps.toast(ctx, message);
    await deps.mark_notice_shown();
    await deps.toast(ctx, `${message} ${HOST_PAGE_NOTICE}`);
  };
}
