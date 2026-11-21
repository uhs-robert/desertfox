import assert from "node:assert/strict";
import { test } from "node:test";
import { ADMISSION_CLAUSES, CONTENT_SOURCES } from "./content_sources.ts";
import { shipped_sources } from "./support/metafile.ts";

test("every file that ships in content.js is on the allow list with an admission clause, and every listed file ships", async () => {
  const shipped = await shipped_sources("src/content/main.ts");
  const listed = Object.keys(CONTENT_SOURCES);
  assert.deepEqual(shipped.filter((path) => !listed.includes(path)), [], "in content.js but not in test/content_sources.ts: list it with its admission clause, or move it to a bundle");
  assert.deepEqual(listed.filter((path) => !shipped.includes(path)), [], "listed in test/content_sources.ts but not in content.js: remove the entry");
  for (const [path, clause] of Object.entries(CONTENT_SOURCES)) assert.ok(ADMISSION_CLAUSES.includes(clause), `${path} names no admission clause`);
});

test("the settings schema reaches neither content.js nor the command line page", async () => {
  for (const entry of ["src/content/main.ts", "src/cmdline/page.ts", "src/cmdline/host.ts"]) {
    const reached = (await shipped_sources(entry)).filter((path) => path === "src/shared/settings_schema.ts");
    assert.deepEqual(reached, [], `${entry} bundles settings_schema.ts`);
  }
});
