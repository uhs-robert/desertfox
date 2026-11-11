import assert from "node:assert/strict";
import { test } from "node:test";
import { create_surface, mount_surface } from "../../src/content/surface.ts";
import { THEME_STORAGE_KEY } from "../../src/shared/theme/apply.ts";
import type { StoredTheme } from "../../src/shared/theme/apply.ts";
import { load_theme } from "../../src/shared/theme/load.ts";

// Its own file: a surface module starts its storage watcher once, so a second fake browser in one process would never be heard.
const moonlight = load_theme("oasis_moonlight", 3)!;
const stored: StoredTheme = { dark: moonlight.dark, light: moonlight.light };

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

test("a surface whose host left the page stops following storage until it is mounted again, and then shows the latest theme", async () => {
  const listeners: Listener[] = [];
  Object.assign(globalThis, { browser: { storage: { local: { get: async () => ({ [THEME_STORAGE_KEY]: stored }) }, onChanged: { addListener: (listener: Listener) => void listeners.push(listener) } } } });
  const fire = (changes: Record<string, { newValue?: unknown }>) => listeners.forEach((listener) => listener(changes, "local"));
  const children: { textContent: string }[] = [];
  const element = (tag: string) => {
    const node = { tag, textContent: "", style: {}, setAttribute: () => {}, getAttribute: () => "1", matches: () => false, isConnected: false, parentElement: null as unknown, attachShadow: () => ({ append: (...nodes: { textContent: string }[]) => void children.push(...nodes) }) };
    return node;
  };
  const root = { append: (host: { isConnected: boolean; parentElement: unknown }) => ((host.isConnected = true), (host.parentElement = root)), querySelectorAll: () => [], querySelector: () => null };
  Object.assign(globalThis, { document: { createElement: element, documentElement: root } });
  const first = create_surface("desertfox-a", "", 1).host as unknown as { isConnected: boolean; parentElement: unknown };
  await new Promise((resolve) => setTimeout(resolve, 0));
  const first_theme = children[1]!;
  mount_surface(first as unknown as HTMLElement);
  first.isConnected = false;
  first.parentElement = null;
  create_surface("desertfox-b", "", 1);
  const changed = { dark: { ...stored.dark, primary: "#abcdef" }, light: stored.light };
  fire({ [THEME_STORAGE_KEY]: { newValue: changed } });
  assert.doesNotMatch(first_theme.textContent, /#abcdef/);
  mount_surface(first as unknown as HTMLElement);
  assert.match(first_theme.textContent, /--desertfox-primary: #abcdef;/);
  fire({ [THEME_STORAGE_KEY]: { newValue: { dark: { ...stored.dark, primary: "#111111" }, light: stored.light } } });
  assert.match(first_theme.textContent, /#111111/);
});
