// A key pressed before the page has its keymap is held, and a key the keymap leaves unbound then reaches the page (#382).
// The test delays the background's keymap read from outside, by wrapping `storage.local.get` for that one key, so src/ needs no hook.

export const areas = ["keys"];

const KEYMAP_DELAY_MS = 2500;

export async function run_cases({ run_case, in_background, url_of, wait_event, events, expect, sleep, press_keys, in_active_tab }) {
  const delay_keymap_reads = (on) => in_background(`(() => {
    const local = browser.storage.local;
    if (!${on}) { if (local.get.original) local.get = local.get.original; return 0; }
    const original = local.get.original ?? local.get;
    local.get = Object.assign((keys) => (keys === "desertfox_compiled_keymap" ? new Promise((resolve) => setTimeout(resolve, ${KEYMAP_DELAY_MS})).then(() => original.call(local, keys)) : original.call(local, keys)), { original });
    return 1;
  })()`);

  await run_case("Space pressed before the keymap loads reaches the page once the keymap arrives", async () => {
    await delay_keymap_reads(true);
    try {
      const mark = events.length;
      await in_background(`browser.tabs.create({ url: ${JSON.stringify(url_of("page", "early_space"))}, active: true }).then((tab) => tab.id)`);
      await sleep(900);
      await press_keys("-k", "space");
      const seen = await wait_event(mark, (event) => event.type === "keydown" && event.key === " " && event.page_id === "early_space", "the page to see the held Space", KEYMAP_DELAY_MS + 4000);
      const opened = events.slice(mark).find((event) => event.type === "visibility" && event.page_id === "early_space");
      // Only a held key arrives after the delay. A key the page got at once would show before it.
      expect(seen.at_ms - opened.at_ms >= KEYMAP_DELAY_MS - 300, `Space reached the page ${seen.at_ms - opened.at_ms} ms after the open, so the keymap delay did not hold it`);
    } finally {
      await delay_keymap_reads(false);
    }
  });

  await run_case("an unbound chord pressed before the keymap loads reaches the page at once", async () => {
    await delay_keymap_reads(true);
    try {
      const mark = events.length;
      await in_background(`browser.tabs.create({ url: ${JSON.stringify(url_of("page", "early_chord"))}, active: true }).then((tab) => tab.id)`);
      await sleep(900);
      await press_keys("-M", "ctrl", "k", "-m", "ctrl");
      const seen = await wait_event(mark, (event) => event.type === "keydown" && event.key === "k" && event.page_id === "early_chord", "the page to see Ctrl+K", KEYMAP_DELAY_MS + 4000);
      const opened = events.slice(mark).find((event) => event.type === "visibility" && event.page_id === "early_chord");
      expect(seen.at_ms - opened.at_ms < KEYMAP_DELAY_MS - 300, `Ctrl+K reached the page ${seen.at_ms - opened.at_ms} ms after the open, so the keymap delay held it`);
    } finally {
      await delay_keymap_reads(false);
    }
  });

  // Presses `keys` while the body is held, then reads the scroll position once the page is in. A number in `keys` is a pause in ms. With `keymap_late` the keys are held for the keymap and replay after it lands, still before the body. A Ctrl chord the default keymap binds is held like any key, and the Ctrl+D case leaves the keymap alone. `tail_ms` also holds the page's last script after the content.
  const press_on_slow_body = async (id, keys, { keymap_late = true, tail_ms = 0 } = {}) => {
    await delay_keymap_reads(keymap_late);
    try {
      const body_ms = KEYMAP_DELAY_MS + 1500;
      const opened = Date.now();
      await in_background(`browser.tabs.create({ url: ${JSON.stringify(url_of("slow_body", id) + `&ms=${body_ms}&tail_ms=${tail_ms}`)}, active: true }).then((tab) => tab.id)`);
      await sleep(900);
      for (const args of keys) await (typeof args === "number" ? sleep(args) : press_keys(...args));
      await sleep(Math.max(0, opened + body_ms + tail_ms + 1500 - Date.now()));
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
    // j waits for room. The content arrives at 4 s and the last script at 7 s, and k is pressed at 4.4 s, so it finds room on a loading page.
    // Queue first then k: down and back up, ending at 0. k first, or j run again at the end, would end at 50.
    const at = await press_on_slow_body("early_flush", [["j"], 3500, ["k"]], { keymap_late: false, tail_ms: 3000 });
    expect(at.y === 0 && at.x === 0, `j then k across the arrival ended at ${JSON.stringify(at)} instead of 0`);
  });
}
