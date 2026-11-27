import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { require_openable } from "../../src/shared/url_build.ts";

const CTX: CommandContext = { tab_id: 7, window_id: 3, frame_id: 0, mode: "normal" };
const globals = globalThis as Record<string, unknown>;

function stub(tab: Record<string, unknown>, toggle_fails = false) {
  const toggled: number[] = [];
  globals.browser = {
    tabs: {
      get: async () => tab,
      toggleReaderMode: async (tab_id: number) => {
        toggled.push(tab_id);
        if (toggle_fails) throw new Error("not readable");
      },
    },
  };
  return toggled;
}

const run = async () => void (await registry.get("page.reader")!.run!(CTX, {}));

test("page.reader toggles Reader View on the active tab of an article", async () => {
  const toggled = stub({ isArticle: true });
  await run();
  assert.deepEqual(toggled, [7]);
});

test("page.reader on a tab in Reader View toggles back to the page", async () => {
  const toggled = stub({ isArticle: false, isInReaderMode: true });
  await run();
  assert.deepEqual(toggled, [7]);
});

test("page.reader refuses a page that is not an article, without toggling", async () => {
  const toggled = stub({ isArticle: false });
  await assert.rejects(run, (error: unknown) => error instanceof RuntimeRefusal && /cannot show this page in Reader View/.test(error.message));
  assert.deepEqual(toggled, []);
});

test("page.reader turns a rejected toggle into a refusal", async () => {
  stub({ isArticle: true }, true);
  await assert.rejects(run, RuntimeRefusal);
});

test("an about:reader address points at the gr key, other about: pages keep the general text", () => {
  assert.throws(() => require_openable("about:reader?url=https%3A%2F%2Fa.example", undefined), /about:reader.*Press gr/);
  assert.throws(() => require_openable("about:config", undefined), /does not open about: addresses/);
});
