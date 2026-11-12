// Opens a privileged Firefox page (about:preferences and the like), which no extension API can open, through the native host.
// Without the host, the address goes to the clipboard for the user to paste into the address bar.

import { NativeHostError } from "../background/native_client.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import type { CommandContext } from "../shared/command.ts";

// Mirrors FIREFOX_PAGES in host/desertfox-host, which a unit test compares. The host takes only the key.
export const FIREFOX_PAGE_ADDRESSES = {
  settings: "about:preferences",
  addons: "about:addons",
  downloads: "about:downloads",
  config: "about:config",
  profiles: "about:profiles",
  support: "about:support",
  debugging: "about:debugging#/runtime/this-firefox",
  logins: "about:logins",
  processes: "about:processes",
  memory: "about:memory",
  policies: "about:policies",
  crashes: "about:crashes",
  protections: "about:protections",
} as const;

export type FirefoxPage = keyof typeof FIREFOX_PAGE_ADDRESSES;

export const FIREFOX_PAGES = Object.keys(FIREFOX_PAGE_ADDRESSES) as FirefoxPage[];

export const HOST_PAGE_NOTICE = "The native host opens these pages in one key. Run :native.install for the install steps.";

export type FirefoxPageDeps = {
  open_page: (page: FirefoxPage) => Promise<void>;
  write_clipboard: (text: string) => Promise<void>;
  // Whether a no-host message already carried HOST_PAGE_NOTICE. Stored, so the notice shows once per profile.
  notice_shown: () => Promise<boolean>;
  mark_notice_shown: () => Promise<void>;
  toast: (ctx: CommandContext, message: string) => Promise<void>;
};

// A missing permission is a missing host from the user's side: the same install page fixes both.
const NO_HOST_FAILURES: ReadonlySet<string> = new Set(["host_missing", "no_permission"]);

export function make_open_firefox_page_handler(deps: FirefoxPageDeps) {
  return async (ctx: CommandContext, args: { page: FirefoxPage }): Promise<void> => {
    try {
      await deps.open_page(args.page);
      return;
    } catch (error) {
      if (!(error instanceof NativeHostError)) throw error;
      if (!NO_HOST_FAILURES.has(error.failure)) throw new RuntimeRefusal(error.message);
    }
    const address = FIREFOX_PAGE_ADDRESSES[args.page];
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
