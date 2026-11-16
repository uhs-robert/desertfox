// A key pressed before the page has its keymap is held, and a key the keymap leaves unbound then reaches the page (#382).
// The test delays the background's keymap read from outside, by wrapping `storage.local.get` for that one key, so src/ needs no hook.

export const areas = ["keys"];

const KEYMAP_DELAY_MS = 2500;
const FOCUS_SETTLE_MS = 300;
const SETTLED_READS = 4;

export async function run_cases({ run_case, in_background, url_of, wait_event, poll_until, events, expect, sleep, press_keys, in_active_tab }) {
  // The background keeps the keymap in memory (keymap_source.ts) and drops it on a change to the key, so turning the delay on rewrites the key to force the next read through the wrapped `get`.
  // That rewrite starts the delayed read at once: the bridge reads the keymap on every change (bridge_browser.ts), and a page that asks later joins that read. So the delay runs from the rewrite, not from the page's open, and `keymap_released_at` records when the read ends.
  const delay_keymap_reads = (on) => in_background(`(async () => {
    const local = browser.storage.local;
    if (!${on}) { if (local.get.original) local.get = local.get.original; return 0; }
    const original = local.get.original ?? local.get;
    globalThis.keymap_released_at = undefined;
    local.get = Object.assign((keys) => (keys === "desertfox_compiled_keymap" ? new Promise((resolve) => setTimeout(resolve, ${KEYMAP_DELAY_MS})).then(() => original.call(local, keys)).then((value) => { globalThis.keymap_released_at = Date.now(); return value; }) : original.call(local, keys)), { original });
    const stored = (await original.call(local, "desertfox_compiled_keymap")).desertfox_compiled_keymap;
    if (stored) await local.set({ desertfox_compiled_keymap: { ...stored, cache_drop_probe: Date.now() } });
    return 1;
  })()`);

  // The key probe (settle_focus) cannot serve here: its F4 is unbound, so the page holds and replays it like any key, which would change what these cases measure. The wait is the page reporting document focus instead. A page that still loads reports nothing yet, so the wait reads it from the background at document_start, which answers while the page loads. The page address must be the real one, because the first document of a new tab is about:blank and answers focus too. The content script's ready attribute cannot serve: it appears with the first keymap, which these cases hold back.
  const open_tab = (url) => in_background(`browser.tabs.create({ url: ${JSON.stringify(url)}, active: true }).then((tab) => tab.id)`);
  const wait_in_front = async (tab_id) => {
    await poll_until(`tab ${tab_id} to report page focus`, () => in_background(`browser.tabs.executeScript(${tab_id}, { code: "document.hasFocus() && location.href.startsWith('http')", runAt: "document_start" }).then((answers) => answers[0] === true)`).catch(() => false));
    // A key in the first moments after the focus is lost (docs/firefox-behavior.md), and no signal marks the end of them here: the probe key would be held, and the page reports nothing while it loads. A run with no pause at all lost every key of the slow body cases.
    await sleep(FOCUS_SETTLE_MS);
  };

  await run_case("Space pressed before the keymap loads reaches the page once the keymap arrives", async () => {
    await delay_keymap_reads(true);
    try {
      const mark = events.length;
      await wait_in_front(await open_tab(url_of("page", "early_space")));
      await wait_event(mark, (event) => event.type === "visibility" && event.page_id === "early_space", "the page to report that it shows");
      await press_keys("-k", "space");
      const seen = await wait_event(mark, (event) => event.type === "keydown" && event.key === " " && event.page_id === "early_space", "the page to see the held Space", KEYMAP_DELAY_MS + 4000);
      // Only a held key arrives after the keymap read ends. A key the page got at once would show about 2 s before it.
      const released_at = await in_background("globalThis.keymap_released_at");
      expect(released_at !== undefined && seen.at_ms >= released_at, `Space reached the page ${released_at - seen.at_ms} ms before the keymap read ended, so the keymap delay did not hold it`);
    } finally {
      await delay_keymap_reads(false);
    }
  });

  await run_case("an unbound chord pressed before the keymap loads reaches the page at once", async () => {
    await delay_keymap_reads(true);
    try {
      const mark = events.length;
      await wait_in_front(await open_tab(url_of("page", "early_chord")));
      await wait_event(mark, (event) => event.type === "visibility" && event.page_id === "early_chord", "the page to report that it shows");
      await press_keys("-M", "ctrl", "k", "-m", "ctrl");
      const seen = await wait_event(mark, (event) => event.type === "keydown" && event.key === "k" && event.page_id === "early_chord", "the page to see Ctrl+K", KEYMAP_DELAY_MS + 4000);
      const opened = events.slice(mark).find((event) => event.type === "visibility" && event.page_id === "early_chord");
      expect(seen.at_ms - opened.at_ms < KEYMAP_DELAY_MS - 300, `Ctrl+K reached the page ${seen.at_ms - opened.at_ms} ms after the open, so the keymap delay held it`);
    } finally {
      await delay_keymap_reads(false);
    }
  });

  // The slow body's content has arrived once the page is taller than the window. A document_start read answers while the page still loads.
  const wait_for_content = () => poll_until("the slow body's content to arrive", () => in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => browser.tabs.executeScript(tab.id, { code: "document.documentElement.scrollHeight > innerHeight * 2", runAt: "document_start" })).then((answers) => answers[0] === true)`).catch(() => false), { timeout_ms: 10000 });

  // Presses `keys` while the body is held, then reads the scroll position once the page is in. A number in `keys` is a pause in ms, and "content" waits for the content to arrive. With `keymap_late` the keys are held for the keymap and replay after it lands, still before the body. A Ctrl chord the default keymap binds is held like any key, and the Ctrl+D case leaves the keymap alone. `tail_ms` also holds the page's last script after the content.
  const press_on_slow_body = async (id, keys, { keymap_late = true, tail_ms = 0 } = {}) => {
    await delay_keymap_reads(keymap_late);
    try {
      const body_ms = KEYMAP_DELAY_MS + 1500;
      await wait_in_front(await open_tab(url_of("slow_body", id) + `&ms=${body_ms}&tail_ms=${tail_ms}`));
      for (const args of keys) {
        if (args === "content") await wait_for_content();
        else await (typeof args === "number" ? sleep(args) : press_keys(...args));
      }
      // The script waits for the load, and the held keys run when it ends. The scroll must then stay the same over SETTLED_READS reads, so a late replay or a second one is not missed.
      let previous = "";
      let equal_reads = 0;
      await poll_until("the scroll position to settle after the load", async () => {
        const now = await in_active_tab("JSON.stringify([scrollX, scrollY])");
        equal_reads = now === previous ? equal_reads + 1 : 0;
        previous = now;
        return equal_reads >= SETTLED_READS;
      }, { timeout_ms: 10000, step_ms: 300 });
      return JSON.parse(await in_active_tab("JSON.stringify({ x: scrollX, y: scrollY, half: innerHeight / 2 })"));
    } finally {
      await delay_keymap_reads(false);
    }
  };

  await run_case("three j pressed while the body is still loading make one step once it arrives", async () => {
    const at = await press_on_slow_body("early_j", [["j", "j", "j"]]);
    expect(at.y === 50 && at.x === 0, `three j scrolled to ${JSON.stringify(at)} instead of one 50 px step`);
  });

  await run_case("j then l pressed while the body is still loading move both axes", async () => {
    const at = await press_on_slow_body("early_jl", [["j"], ["l"]]);
    expect(at.y === 50 && at.x === 50, `j then l scrolled to ${JSON.stringify(at)} instead of 50 down and 50 right`);
  });

  await run_case("G pressed while the body is still loading scrolls to the bottom once it arrives", async () => {
    const at = await press_on_slow_body("early_G", [["G"], ["j"]]);
    // The j after G runs in the same tick at the load. A smooth G would be cut short by it and end at 50.
    expect(at.y > 1000, `G scrolled to ${JSON.stringify(at)}`);
  });

  await run_case("Ctrl+D pressed while the body is still loading scrolls half a page once it arrives", async () => {
    const at = await press_on_slow_body("early_pages", [["-M", "ctrl", "d", "-m", "ctrl"]], { keymap_late: false });
    expect(Math.abs(at.y - at.half) < 20, `Ctrl+D scrolled to ${JSON.stringify(at)}`);
  });

  await run_case("a press that finds room while the page still loads runs the queued ones first, once", async () => {
    // j waits for room. The content arrives at 4 s and the last script at 7 s, and k is pressed once the content is in, so it finds room on a loading page.
    // Queue first then k: down and back up, ending at 0. k first, or j run again at the end, would end at 50.
    const at = await press_on_slow_body("early_flush", [["j"], "content", 200, ["k"]], { keymap_late: false, tail_ms: 3000 });
    expect(at.y === 0 && at.x === 0, `j then k across the arrival ended at ${JSON.stringify(at)} instead of 0`);
  });
}
