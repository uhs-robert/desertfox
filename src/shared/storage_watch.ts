// Pages and lazy bundles follow `storage.local` through these. Never imported by content.js.

// Where the config and settings in force came from. Written at every startup and at the end of every settings edit, so a write of it tells every page that settings changed. The hint script reads its letters from it.
export const CONFIG_STATUS_STORAGE_KEY = "desertfox_config_status";

// The config `config.reload` last built from the files. Written after the status key, so it is the last write of a reload.
export const FILES_CONFIG_STORAGE_KEY = "desertfox_files_config";

// Calls `on_value` with the stored value now and again at every change. A failed first read calls it with undefined, so a caller that waits
// on the first read never waits forever. Nothing is called when storage is unavailable.
export function watch_stored<T>(key: string, on_value: (value: T | undefined) => void): void {
  if (typeof browser === "undefined") return;
  void browser.storage.local.get(key).then((stored) => on_value(stored[key] as T | undefined), () => on_value(undefined));
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && key in changes) on_value(changes[key]!.newValue as T | undefined);
  });
}

// What `storage.onChanged` reports when the settings in force changed. Only the background writes the saved and temp layers, and every edit ends with a write of the config status. A reload writes the status first and the files config after it, so a read between the two sees the old files: the files config key tells the page too.
export function touches_settings(changes: Record<string, unknown>, area: string): boolean {
  return area === "local" && (CONFIG_STATUS_STORAGE_KEY in changes || FILES_CONFIG_STORAGE_KEY in changes);
}

// What a redraw would lose: the scroll position and the focused element, named by id or by the href it links to.
function focus_key(): string | undefined {
  const active = document.activeElement;
  if (!active || active === document.body) return undefined;
  if (active.id) return `#${CSS.escape(active.id)}`;
  const href = active.getAttribute("href");
  return href === null ? undefined : `[href="${CSS.escape(href)}"]`;
}

// Runs `draw(true)` now and `draw(false)` at each settings change, one at a time: a change that lands during a draw runs one more draw after it, so a late answer never overwrites a newer one.
// The scroll position and focus live here, outside the page's DOM, and go back in after each draw. A page keeps its own timers and listeners, and a draw must stop the ones the last draw started.
export function follow_settings(draw: (first: boolean) => void | Promise<void>): void {
  let running = false;
  let again = false;
  const run = async (first: boolean) => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    let is_first = first;
    try {
      do {
        again = false;
        // Anything that throws, the draw or the restore, leaves the last page in place and the next change draws again.
        try {
          const { scrollX, scrollY } = window;
          const key = focus_key();
          await draw(is_first);
          if (!is_first) {
            window.scrollTo(scrollX, scrollY);
            if (key) document.querySelector<HTMLElement>(key)?.focus({ preventScroll: true });
          }
        } catch (error) {
          console.error("desertfox: page draw failed", error);
        }
        is_first = false;
      } while (again);
    } finally {
      running = false;
    }
  };
  void run(true);
  if (typeof browser === "undefined") return;
  browser.storage.onChanged.addListener((changes, area) => {
    if (touches_settings(changes, area)) void run(false);
  });
}
