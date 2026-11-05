import assert from "node:assert/strict";
import { test } from "node:test";
import { create_surface } from "../../src/content/surface.ts";
import { THEME_STORAGE_KEY, USER_CSS_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import { theme_css, watch_stored } from "../../src/shared/theme/apply.ts";
import type { StoredTheme } from "../../src/shared/theme/apply.ts";
import { load_theme } from "../../src/shared/theme/load.ts";

const moonlight = load_theme("oasis_moonlight", 3)!;
const stored: StoredTheme = { dark: moonlight.dark, light: moonlight.light };

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

// A storage with the given local values and a way to fire a change.
function fake_browser(values: Record<string, unknown>) {
  const listeners: Listener[] = [];
  Object.assign(globalThis, {
    browser: {
      storage: {
        local: { get: async (key: string) => ({ [key]: values[key] }) },
        onChanged: { addListener: (listener: Listener) => void listeners.push(listener) },
      },
    },
  });
  return (changes: Record<string, { newValue?: unknown }>, area = "local") => listeners.forEach((listener) => listener(changes, area));
}

test("theme_css sets every role token on the selector, dark first and light under the system light scheme", () => {
  const css = theme_css(stored, ".x");
  assert.match(css, new RegExp(`^\\.x \\{ --oasisfox-bg-core: ${stored.dark.bg_core};`));
  assert.match(css, new RegExp(`@media \\(prefers-color-scheme: light\\) \\{ \\.x \\{ --oasisfox-bg-core: ${stored.light.bg_core};`));
  assert.equal(css.match(/--oasisfox-mode-visual/g)?.length, 2);
});

test("theme_css skips a role that is not a string", () => {
  const broken = { dark: { ...stored.dark, accent: undefined }, light: stored.light } as unknown as StoredTheme;
  assert.doesNotMatch(theme_css(broken, ".x").split("@media")[0]!, /--oasisfox-accent/);
});

test("watch_stored reports the stored value, then each change of its key in local storage only", async () => {
  const fire = fake_browser({ k: 1 });
  const seen: unknown[] = [];
  watch_stored("k", (value) => seen.push(value));
  await new Promise((resolve) => setTimeout(resolve, 0));
  fire({ k: { newValue: 2 } });
  fire({ other: { newValue: 3 } });
  fire({ k: { newValue: 4 } }, "session");
  assert.deepEqual(seen, [1, 2]);
});

// Just enough DOM to read the order of a surface's shadow children.
function fake_surface_dom() {
  const appended: { textContent: string; tag: string }[] = [];
  const element = (tag: string) => ({ tag, textContent: "", style: {}, setAttribute: () => {}, attachShadow: () => ({ append: (...nodes: typeof appended) => void appended.push(...nodes) }) });
  Object.assign(globalThis, { document: { createElement: element } });
  return appended;
}

test("a surface holds its built-in style, then the theme sheet, then user CSS, and both follow storage changes", async () => {
  const fire = fake_browser({ [THEME_STORAGE_KEY]: stored, [USER_CSS_STORAGE_KEY]: "a { color: red }" });
  const children = fake_surface_dom();
  create_surface("oasisfox-test", "built-in", 1);
  const [built_in, theme_sheet, user_sheet] = children;
  assert.equal(built_in!.textContent, "built-in");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(theme_sheet!.textContent, /^\.oasisfox-test \{ --oasisfox-bg-core:/);
  assert.equal(user_sheet!.textContent, "a { color: red }");
  fire({ [THEME_STORAGE_KEY]: { newValue: { dark: { ...stored.dark, primary: "#123456" }, light: stored.light } } });
  assert.match(theme_sheet!.textContent, /--oasisfox-primary: #123456;/);
  fire({ [USER_CSS_STORAGE_KEY]: { newValue: "b {}" } });
  assert.equal(user_sheet!.textContent, "b {}");
});
