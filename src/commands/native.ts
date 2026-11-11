import { show_toast_on_tab } from "../background/browser_deps.ts";
import { MANUAL_HINT } from "../background/host_update.ts";
import { host_update } from "../background/startup.ts";
import { HELP_PAGE_FILE } from "../help/route.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import { define } from "../shared/registry/builtin.ts";
import { grant_hash, GRANTABLE_PERMISSIONS } from "../shared/permission_grant.ts";
import type { GrantablePermission } from "../shared/permission_grant.ts";
import { open_help_url } from "./help_tab.ts";

async function open_grant_panel(ctx: Parameters<typeof open_help_url>[0], permission: GrantablePermission): Promise<void> {
  const help_page_url = browser.runtime.getURL(HELP_PAGE_FILE);
  await open_help_url(ctx, help_page_url, help_page_url + grant_hash(permission, Date.now()));
}

define("native.install", {
  label: "Install native host",
  intent: "Open the page that installs the native host. It has the permission button, the install command and the button that lets the host keep itself updated. After this one install the host updates itself.",
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: (ctx) => open_grant_panel(ctx, "nativeMessaging"),
});

define("native.update", {
  label: "Update native host",
  intent: "Update the native host to the version of this extension. It checks the files against SHA-256 hashes in the signed extension. The host must have been installed once with native.install.",
  bridge: false,
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
  run: (ctx, args) => open_grant_panel(ctx, args.permission as GrantablePermission),
});
