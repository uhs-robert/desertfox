import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { apply_count } from "../../src/background/count.ts";
import { check_args } from "../../src/shared/registry/index.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

type Updated = { id: number; url: string };

function install_browser(tab_url: string, updated: Updated[]): void {
  (globalThis as unknown as { browser: unknown }).browser = {
    tabs: {
      get: async () => ({ url: tab_url }),
      update: async (id: number, props: { url: string }) => updated.push({ id, url: props.url }),
    },
  };
}

const command = registry.get("url.increment")!;

// The same path a key press takes: the count fills `amount`, then the validator, then the handler.
async function press(tab_url: string, direction: string, count?: number): Promise<Updated[]> {
  const updated: Updated[] = [];
  install_browser(tab_url, updated);
  const counted = apply_count(command, { id: "url.increment", args: { direction }, ...(count === undefined ? {} : { count }) });
  const checked = check_args(command, counted.args ?? {});
  assert.ok(checked.ok);
  await (command.run as (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>)({ tab_id: 7, window_id: 1 }, checked.args);
  return updated;
}

test("up and down change the number by one", async () => {
  assert.deepEqual(await press("https://a.com/page/5", "up"), [{ id: 7, url: "https://a.com/page/6" }]);
  assert.deepEqual(await press("https://a.com/page/5", "down"), [{ id: 7, url: "https://a.com/page/4" }]);
});

test("a count sets the amount", async () => {
  assert.deepEqual(await press("https://a.com/page/5", "up", 5), [{ id: 7, url: "https://a.com/page/10" }]);
  assert.deepEqual(await press("https://a.com/page/5", "down", 3), [{ id: 7, url: "https://a.com/page/2" }]);
});

test("a refusal opens nothing", async () => {
  await assert.rejects(press("https://a.com/page/2", "down", 3), /below 0/);
  await assert.rejects(press("https://a.com/about", "up"), /no number/);
});

test("the validator rejects a bad direction and an amount below 1", () => {
  assert.equal(check_args(command, { direction: "sideways" }).ok, false);
  assert.equal(check_args(command, { direction: "up", amount: 0 }).ok, false);
});
