import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve_container_store_id } from "../../src/commands/open_target.ts";

const find = async (name: string) => (name === "Family" ? "store-family" : undefined);

test("a named container resolves to its cookie store", async () => {
  assert.equal(await resolve_container_store_id("Family", find), "store-family");
});

test("default means no container, without a lookup", async () => {
  const never = async (): Promise<string | undefined> => assert.fail("looked up default");
  assert.equal(await resolve_container_store_id("default", never), "firefox-default");
});

test("no container name stays undefined", async () => {
  assert.equal(await resolve_container_store_id(undefined, find), undefined);
});

test("an unknown container is refused by name", async () => {
  await assert.rejects(resolve_container_store_id("Nope", find), /Nope/);
});
