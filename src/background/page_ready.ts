// Waits for a tab to finish loading and its content script to answer. Global mark jumps use it, and a macro replay can use it between steps.
// The browser is injected, so a test drives every result with fakes.

export const PAGE_READY_TIMEOUT_MS = 10_000;

// `no_script` is a loaded page DesertFox does not run on (an error page, `about:`, the PDF viewer).
export type PageReady = "ready" | "timeout" | "gone" | "no_script";

type Listener<Args extends unknown[]> = {
  addListener: (listener: (...args: Args) => void) => void;
  removeListener: (listener: (...args: Args) => void) => void;
};

export type PageReadyDeps = {
  // Undefined when the tab is gone.
  get_tab: (tab_id: number) => Promise<{ status?: string | undefined } | undefined>;
  on_updated: Listener<[number, { status?: string | undefined; url?: string | undefined }]>;
  on_removed: Listener<[number]>;
  has_content_script: (tab_id: number) => Promise<boolean>;
  set_timer: (callback: () => void, ms: number) => unknown;
  clear_timer: (timer: unknown) => void;
};

export type PageWatch = {
  // The tab started loading or changed its address since the watch began.
  navigated: () => boolean;
  // `requires_navigation` ignores a `complete` that was there before the navigation started. Never throws.
  done: (timeout_ms?: number, options?: { requires_navigation: boolean }) => Promise<PageReady>;
  // Unsubscribes. A pending `done` settles as `gone`.
  stop: () => void;
};

// Call this before the step that navigates. Right after `tabs.update` a tab still reads `complete`, and the `loading` status follows a moment later, so a late subscriber would take the old page as ready.
export function watch_page_ready(deps: PageReadyDeps, tab_id: number): PageWatch {
  let loading_seen = false;
  let url_changed = false;
  let status: string | undefined;
  let removed = false;
  let stopped = false;
  let wake: (() => void) | undefined;

  const on_updated = (id: number, change: { status?: string | undefined; url?: string | undefined }) => {
    if (id !== tab_id) return;
    if (change.status === "loading") loading_seen = true;
    if (change.url !== undefined) url_changed = true;
    if (change.status !== undefined) status = change.status;
    wake?.();
  };
  const on_removed = (id: number) => {
    if (id !== tab_id) return;
    removed = true;
    wake?.();
  };
  deps.on_updated.addListener(on_updated);
  deps.on_removed.addListener(on_removed);

  function unsubscribe() {
    if (stopped) return;
    stopped = true;
    deps.on_updated.removeListener(on_updated);
    deps.on_removed.removeListener(on_removed);
  }

  return {
    navigated: () => loading_seen || url_changed,
    stop: () => {
      unsubscribe();
      wake?.();
    },
    done: (timeout_ms = PAGE_READY_TIMEOUT_MS, { requires_navigation } = { requires_navigation: false }) =>
      new Promise<PageReady>((resolve) => {
        let finished = false;
        let checking = false;
        const timer = deps.set_timer(() => finish("timeout"), timeout_ms);

        function finish(result: PageReady) {
          if (finished) return;
          finished = true;
          deps.clear_timer(timer);
          unsubscribe();
          wake = undefined;
          resolve(result);
        }

        async function check() {
          if (finished || checking) return;
          if (removed || stopped) return finish("gone");
          if (status !== "complete" || (requires_navigation && !loading_seen)) return;
          checking = true;
          const has_script = await deps.has_content_script(tab_id).catch(() => false);
          checking = false;
          if (!finished) finish(has_script ? "ready" : "no_script");
        }

        wake = () => void check();
        deps
          .get_tab(tab_id)
          .then((tab) => {
            if (tab === undefined) return finish("gone");
            if (status === undefined) status = tab.status;
            return check();
          })
          .catch(() => finish("gone"));
        void check();
      }),
  };
}
