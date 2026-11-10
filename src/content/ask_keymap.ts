// Asks the background for the page's keymap and hands the newest answer to `install`.

const MAX_ASKS = 30;
const RETRY_PAUSE_MS = 100;

// The background may not have registered its listener yet, so a rejected ask is retried. After the last one the page gets no keymap, and the next `tree_updated` asks again.
// A reply, even an empty one, ends the loop.
export function create_keymap_asks<Reply>(send: () => Promise<Reply | undefined>, install: (reply: Reply | undefined) => void, retry_pause_ms = RETRY_PAUSE_MS) {
  let latest_ask = 0;
  return async function ask(): Promise<void> {
    const this_ask = ++latest_ask;
    let reply: Reply | undefined;
    for (let attempt = 0; attempt < MAX_ASKS; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, retry_pause_ms));
      // An ask that a newer one overtook stops, so a slow old reply cannot replace a newer tree.
      if (this_ask !== latest_ask) return;
      try {
        reply = await send();
        break;
      } catch {}
    }
    if (this_ask === latest_ask) install(reply);
  };
}
