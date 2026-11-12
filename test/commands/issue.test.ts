import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { make_issue_handler } from "../../src/commands/issue.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import type { CommandContext } from "../../src/shared/command.ts";

const CTX: CommandContext = { tab_id: 1, window_id: 1, frame_id: 0, mode: "normal" };

function make() {
  const log: string[] = [];
  const handler = make_issue_handler({
    gather: async () => ({ version: "1", channel: "1", firefox: "130", os: "linux x86-64", warnings: ["w"], config_dir: "" }),
    open_tab: async (_ctx, url) => void log.push(`open ${url}`),
    copy: async (text) => void log.push(`copy ${text.split("\n")[0]}`),
    toast: async (_ctx, message) => void log.push(`toast ${message}`),
  });
  return { handler, log };
}

test("by default it opens the prefilled form and copies nothing", async () => {
  const { handler, log } = make();
  await handler(CTX, { target: "form" });
  assert.equal(log.length, 1);
  assert.match(log[0]!, /^open https:\/\/github\.com\/uhs-robert\/desertfox\/issues\/new\?title=&body=/);
});

test("copy puts the report on the clipboard and opens the blank form", async () => {
  const { handler, log } = make();
  await handler(CTX, { target: "copy" });
  assert.match(log[0]!, /^copy /);
  assert.equal(log[1], "open https://github.com/uhs-robert/desertfox/issues/new");
  assert.match(log[2]!, /^toast /);
});

test("help.issue is named issue, has no key and takes only the copy flag", () => {
  const command = registry.get("help.issue")!;
  assert.equal(command.name, "issue");
  assert.equal(check_args(command, {}, {}).ok, true);
  assert.equal(check_args(command, { target: "copy" }, {}).ok, true);
  assert.equal(check_args(command, { target: "nope" }, {}).ok, false);
});
