// Asks the background for the page's keymap and hands the newest answer to `install`.

const ASKS = 30;
const PAUSE_MS = 100;

// The background may not have registered its listener yet, so a rejected ask is retried. After the last one the page gets no keymap, and the next `tree_updated` asks again.
// A reply (even an empty one) ends the loop. An ask that a newer one overtook stops, so a slow old reply cannot replace a newer tree.
export function create_keymap_asks<Reply>(send: () => Promise<Reply | undefined>, install: (reply: Reply | undefined) => void, pause_ms = PAUSE_MS) {
  let newest = 0;
  return async function ask(): Promise<void> {
    const mine = ++newest;
    let reply: Reply | undefined;
    for (let attempt = 0; attempt < ASKS; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, pause_ms));
      if (mine !== newest) return;
      try {
        reply = await send();
        break;
      } catch {}
    }
    if (mine === newest) install(reply);
  };
}
