import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { parse_command_line, registry } from "../../src/shared/registry/index.ts";

const created: string[] = [];
(globalThis as unknown as { browser: unknown }).browser = {
  runtime: { getURL: (path: string) => `moz-extension://id/${path}` },
  tabs: { create: async (props: { url: string }) => created.push(props.url) },
};

const sources = { search_engines: ["duck", "github.repo.issues"], containers: [] };

test("engine.show opens the help page at the engine row", async () => {
  await (registry.get("engine.show")!.run as (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>)({}, { engine: "github.repo.issues" });
  assert.deepEqual(created, ["moz-extension://id/home.html#engine=github.repo.issues"]);
});

test("engine.show names a dotted engine on the command line and refuses an unknown one", () => {
  const parsed = parse_command_line(registry, "engine.show github.repo.issues", sources);
  assert.equal(parsed.kind, "invocation", JSON.stringify(parsed));
  if (parsed.kind === "invocation") {
    assert.deepEqual(parsed.invocation, { id: "engine.show", args: { engine: "github.repo.issues" } });
    assert.equal(check_args(registry.get("engine.show")!, parsed.invocation.args, sources).ok, true);
  }
  const unknown = parse_command_line(registry, "engine.show ghost", sources);
  assert.ok(unknown.kind === "error" || !check_args(registry.get("engine.show")!, { engine: "ghost" }, sources).ok);
});
