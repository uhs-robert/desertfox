import { HELP_PAGE_FILE } from "../help/route.ts";
import { define } from "../shared/registry/builtin.ts";
import { native_install_hash } from "../shared/native_host.ts";
import { open_help_url } from "./help_tab.ts";

define("native.install", {
  label: "Install native host",
  intent: "Open the page that installs the native host. It has the permission button and the install command.",
  runs_in: "background",
  repeatable: false,
  run: async (ctx) => {
    const help_page_url = browser.runtime.getURL(HELP_PAGE_FILE);
    await open_help_url(ctx, help_page_url, help_page_url + native_install_hash(Date.now()));
  },
});
