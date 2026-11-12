import { BLANK_ISSUE_URL, issue_report, issue_url } from "../background/issue_report.ts";
import type { IssueFacts } from "../background/issue_report.ts";
import { show_toast_on_tab } from "../background/browser_deps.ts";
import { FILES_SOURCE_STORAGE_KEY, WARNINGS_STORAGE_KEY } from "../background/storage_keys.ts";
import type { CommandContext } from "../shared/command.ts";
import { host_channel } from "../shared/native_host.ts";
import { define } from "../shared/registry/builtin.ts";
import { open_in } from "./open_target.ts";

export type IssueDeps = {
  gather: () => Promise<IssueFacts>;
  open_tab: (ctx: CommandContext, url: string) => Promise<void>;
  copy: (text: string) => Promise<void>;
  toast: (ctx: CommandContext, message: string) => Promise<void>;
};

export function make_issue_handler(deps: IssueDeps) {
  return async (ctx: CommandContext, args: { target?: unknown }): Promise<void> => {
    const facts = await deps.gather();
    if (args.target === "copy") {
      await deps.copy(issue_report(facts, "copy").body);
      await deps.open_tab(ctx, BLANK_ISSUE_URL);
      await deps.toast(ctx, "Report copied. Paste it into the issue form");
      return;
    }
    await deps.open_tab(ctx, issue_url(issue_report(facts, "form")));
  };
}

async function gather_facts(): Promise<IssueFacts> {
  const [info, platform, self, stored] = await Promise.all([
    browser.runtime.getBrowserInfo(),
    browser.runtime.getPlatformInfo(),
    browser.management.getSelf(),
    browser.storage.local.get([WARNINGS_STORAGE_KEY, FILES_SOURCE_STORAGE_KEY]),
  ]);
  const version = browser.runtime.getManifest().version;
  const source = stored[FILES_SOURCE_STORAGE_KEY] as { dir_label?: unknown } | undefined;
  return {
    version,
    channel: host_channel(self.installType, version),
    firefox: `${info.version}`,
    os: `${platform.os} ${platform.arch}`,
    warnings: (stored[WARNINGS_STORAGE_KEY] as string[] | undefined) ?? [],
    config_dir: typeof source?.dir_label === "string" ? source.dir_label : "",
  };
}

const handler = make_issue_handler({
  gather: gather_facts,
  open_tab: (ctx, url) => open_in(ctx, url, "tab"),
  copy: (text) => navigator.clipboard.writeText(text),
  toast: (ctx, message) => show_toast_on_tab(ctx, "issue", message, "info"),
});

define("help.issue", {
  name: "issue",
  label: "Report an issue",
  intent: "Open a prefilled GitHub issue form. It holds the DesertFox and Firefox versions, the system and the warning count. Read it there before you submit, because the command sends nothing itself. The copy flag puts the report with the warning text on the clipboard and opens the blank form.",
  params: [
    {
      name: "target",
      type: "enum",
      values: ["form", "copy"],
      default: "form",
      short: { copy: "c" },
      value_labels: { copy: "to the clipboard" },
      description: { copy: "Copy the full report, open the blank form." },
    },
  ],
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handler(ctx, args),
});
