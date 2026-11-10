// A key pressed before the page has its keymap is held, and a key the keymap leaves unbound then reaches the page (#382).
// The test delays the background's keymap read from outside, by wrapping `storage.local.get` for that one key, so src/ needs no hook.

export const areas = ["keys"];

const KEYMAP_DELAY_MS = 2500;

export async function run_cases({ run_case, in_background, url_of, wait_event, events, expect, sleep, press_keys }) {
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
}
