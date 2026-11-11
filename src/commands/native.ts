import { HELP_PAGE_FILE } from "../help/route.ts";
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
  intent: "Open the page that installs the native host. It has the permission button and the install command.",
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: (ctx) => open_grant_panel(ctx, "nativeMessaging"),
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
