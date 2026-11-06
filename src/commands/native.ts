import { plan_help_tab } from "../background/open_help.ts";
import { HELP_PAGE_FILE } from "../help/route.ts";
import { define } from "../shared/registry/index.ts";
import { NATIVE_INSTALL_HASH } from "../shared/native_host.ts";

define("native.install", {
  label: "Install native host",
  intent: "Open the page that installs the native host. It has the permission button and the install command.",
  runs_in: "background",
  repeatable: false,
  run: async (ctx) => {
    const help_page_url = browser.runtime.getURL(HELP_PAGE_FILE);
    const asking_tab = ctx.tab_id === undefined ? undefined : await browser.tabs.get(ctx.tab_id);
    const plan = plan_help_tab(help_page_url, help_page_url + NATIVE_INSTALL_HASH, { id: ctx.tab_id, window_id: ctx.window_id, url: asking_tab?.url });
    if (plan.kind === "update") {
      await browser.tabs.update(plan.tab_id, { url: plan.url });
      return;
    }
    await browser.tabs.create({ url: plan.url, active: true, ...plan.opener });
  },
});
