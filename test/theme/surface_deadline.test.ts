import assert from "node:assert/strict";
import { test } from "node:test";
import { create_surface } from "../../src/content/surface.ts";
import { FIRST_READ_DEADLINE_MS, THEME_STORAGE_KEY } from "../../src/shared/theme/apply.ts";
import { load_theme } from "../../src/shared/theme/load.ts";

// Its own file: a surface module counts its first reads once per process.
test("a hung read reveals the surface at the deadline, and a late read still applies without hiding it again", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const moonlight = load_theme("oasis_moonlight", 3)!;
  const settle: Record<string, () => void> = {};
  const children: { textContent: string }[] = [];
  Object.assign(globalThis, {
    browser: { storage: { local: { get: (key: string) => new Promise((resolve) => (settle[key] = () => resolve({ [key]: key === THEME_STORAGE_KEY ? { dark: moonlight.dark, light: moonlight.light } : ".a { color: red }" }))) }, onChanged: { addListener: () => {} } } },
    document: { createElement: () => ({ textContent: "", style: {}, setAttribute: () => {}, attachShadow: () => ({ append: (...nodes: { textContent: string }[]) => void children.push(...nodes) }), isConnected: true }) },
  });
  const host = create_surface("desertfox-a", "", 1).host;
  assert.equal(host.style.visibility, "hidden");
  t.mock.timers.tick(FIRST_READ_DEADLINE_MS - 1);
  assert.equal(host.style.visibility, "hidden");
  t.mock.timers.tick(1);
  assert.equal(host.style.visibility, "");
  assert.equal(create_surface("desertfox-b", "", 1).host.style.visibility, undefined);
  settle[THEME_STORAGE_KEY]!();
  settle["desertfox_user_css"]!();
  await Promise.resolve();
  await Promise.resolve();
  assert.match(children[1]!.textContent, /--desertfox-primary/);
  assert.equal(children[2]!.textContent, ".a { color: red }");
  assert.equal(host.style.visibility, "");
});
