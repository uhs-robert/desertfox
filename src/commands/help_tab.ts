import { plan_help_tab } from "../background/open_help.ts";
import type { CommandContext } from "../shared/command.ts";

// Opens a help page URL beside the asking tab, or navigates in place when that tab already shows the help page.
// `help.open` and `native.install` share it.
export async function open_help_url(ctx: CommandContext, help_page_url: string, target_url: string): Promise<void> {
  const asking_tab = ctx.tab_id === undefined ? undefined : await browser.tabs.get(ctx.tab_id);
  const plan = plan_help_tab(help_page_url, target_url, { id: ctx.tab_id, window_id: ctx.window_id, url: asking_tab?.url });
  if (plan.kind === "update") {
    await browser.tabs.update(plan.tab_id, { url: plan.url });
    return;
  }
  // Firefox rejects an openerTabId from another window, so the window goes with it.
  await browser.tabs.create({ url: plan.url, active: true, ...plan.opener });
}
