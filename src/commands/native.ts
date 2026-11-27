import { show_toast_on_tab } from "../background/browser_deps.ts";
import { MANUAL_HINT } from "../background/host_update.ts";
import { host_update, native_host } from "../background/config_main.ts";
import { FIREFOX_PAGE_NOTICE_STORAGE_KEY } from "../shared/config/storage_keys.ts";
import { HELP_PAGE_FILE } from "../shared/page/help_route.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import { define } from "../shared/registry/builtin.ts";
import { grant_hash, GRANTABLE_PERMISSIONS } from "../shared/permission_grant.ts";
import type { GrantablePermission } from "../shared/permission_grant.ts";
import { browser_module_call } from "../background/browser_module_call.ts";
import { BROWSER_MODULE_HELLO_STORAGE_KEY, FIREFOX_PAGE_WHERE, validate_module_hello } from "../shared/browser_module_protocol.ts";
import { FIREFOX_PAGES, MODULE_FIREFOX_PAGES } from "../shared/firefox_pages.ts";
import { FIREFOX_PAGE_OPEN_KIND, make_open_firefox_page_handler } from "./firefox_page.ts";
import { open_help_url } from "./help_tab.ts";

async function open_grant_panel(ctx: Parameters<typeof open_help_url>[0], permission: GrantablePermission): Promise<void> {
  const help_page_url = browser.runtime.getURL(HELP_PAGE_FILE);
  await open_help_url(ctx, help_page_url, help_page_url + grant_hash(permission, Date.now()));
}

define("native.install", {
  label: "Install native host",
  intent: "Open the page that installs the native host. It has the permission button, the install command and the button that lets the host keep itself updated. After this one install the host updates itself.",
  bridge: false,
  advanced: true,
  runs_in: "background",
  repeatable: false,
  run: (ctx) => open_grant_panel(ctx, "nativeMessaging"),
});

define("native.update", {
  label: "Update native host",
  intent: "Update the native host to the version of this extension. It checks the files against SHA-256 hashes in the signed extension. The host must have been installed once with native.install.",
  bridge: false,
  advanced: true,
  runs_in: "background",
  repeatable: false,
  run: async (ctx) => {
    let outcome: Awaited<ReturnType<typeof host_update.update_now>>;
    try {
      outcome = await host_update.update_now();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new RuntimeRefusal(`Host update failed: ${reason}. ${MANUAL_HINT}`);
    }
    await show_toast_on_tab(ctx, "host_update", outcome.updated ? `Native host updated to ${outcome.version}` : `Native host is already at ${outcome.version}`, "success");
  },
});

// Firefox grants an optional permission only from a click on a page of the add-on, so the command opens the panel and the button asks.
define("permissions.grant", {
  label: "Grant a permission",
  intent: "Open the page that grants an optional permission. The nativeMessaging permission reaches the native host. The browsingData permission lets the clear-and-reload keys clear site data.",
  params: [{ name: "permission", type: "string", main: true, values: [...GRANTABLE_PERMISSIONS], strict: true, description: "Name the permission to grant." }],
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => open_grant_panel(ctx, args.permission),
});

export const open_firefox_page = make_open_firefox_page_handler({
  module_opens_pages: async () => {
    const hello = validate_module_hello((await browser.storage.session.get(BROWSER_MODULE_HELLO_STORAGE_KEY))[BROWSER_MODULE_HELLO_STORAGE_KEY]);
    return hello.ok && hello.value.firefox_pages === true;
  },
  module_open: (args) => browser_module_call.call(FIREFOX_PAGE_OPEN_KIND, args),
  open_page: (page) => native_host.open_firefox_page(page),
  write_clipboard: (text) => navigator.clipboard.writeText(text),
  notice_shown: async () => (await browser.storage.local.get(FIREFOX_PAGE_NOTICE_STORAGE_KEY))[FIREFOX_PAGE_NOTICE_STORAGE_KEY] === true,
  mark_notice_shown: () => browser.storage.local.set({ [FIREFOX_PAGE_NOTICE_STORAGE_KEY]: true }),
  toast: (ctx, message) => show_toast_on_tab(ctx, "firefox_page", message, "info"),
});

define("browser.open_firefox_page", {
  name: "firefox",
  label: "Open a Firefox page",
  intent: "Open a Firefox page that extensions cannot open. Settings and its sections, add-ons, about:config and more open in a tab of this window, or in this tab. The browser module opens it and switches to a tab that already shows it. Without the module the native host asks Firefox to open it in a new tab. Without either, the address goes to the clipboard to paste into the address bar. Add-on shortcuts have no address, so only the module opens them. Passwords open through the host or the clipboard only.",
  params: [
    { name: "page", type: "string", main: true, values: FIREFOX_PAGES, strict: true, description: "Name the Firefox page to open." },
    // Only the module can replace a tab, and it never opens the passwords page.
    { name: "where", type: "enum", values: FIREFOX_PAGE_WHERE, default: "tab", value_when: { here: { page: MODULE_FIREFOX_PAGES } }, value_labels: { here: "here" }, description: { here: "Replace this tab with the page." } },
  ],
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => open_firefox_page(ctx, { page: args.page, where: args.where }),
});
