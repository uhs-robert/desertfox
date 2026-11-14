// Prefs the seed drops from test/key/user.js. The first two hide the new tab and the start page, which the maintainer's test needs. The notification line is a workaround for the nested session's missing notification server.
const DROPPED_PREFS = new Set(["browser.newtabpage.enabled", "browser.startup.page", "alerts.useSystemBackend"]);

// The start page is on again (web-ext's defaults turn it off, so it is also set with --pref). The cache lines keep the profile small for a window that lives for one test round.
const ADDED_LINES = ['user_pref("browser.startup.page", 1);', 'user_pref("browser.cache.disk.enable", false);', 'user_pref("browser.cache.memory.capacity", 32768);'];

// Filters by exact pref name, not by line, so a reordered key-test file still seeds right. Comment lines go too: they describe test-only lines.
export function seed_user_js(base_text: string): string {
  const kept = base_text.split("\n").filter((line) => {
    if (line.startsWith("//")) return false;
    const name = /^user_pref\("([^"]+)"/.exec(line)?.[1];
    return name === undefined || !DROPPED_PREFS.has(name);
  });
  return [...kept.filter((line) => line.trim() !== ""), ...ADDED_LINES, ""].join("\n");
}
