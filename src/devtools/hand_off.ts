// The devtools page: selects each pick the background relays in the Inspector. The expression is a constant and carries no page data. The picked node never travels as text: the hints bundle left it on the page window, and `inspect()` takes it from there.

// Read and delete in one eval: page script runs between two evals, so a second pick written there would be deleted unseen. The delete comes first, so a failing `inspect` still leaves nothing on the page.
export const INSPECT_EXPRESSION = "(p => { delete window.__desertfox_pick; inspect(p) })(window.__desertfox_pick)";

const RECONNECT_MS = 1000;

type PagePort = {
  postMessage: (message: unknown) => void;
  onMessage: { addListener: (listener: (message: unknown) => void) => void };
  onDisconnect: { addListener: (listener: () => void) => void };
};

export type PageDeps = {
  tab_id: number;
  connect: () => PagePort;
  evaluate: (expression: string) => Promise<unknown>;
  schedule: (action: () => void, ms: number) => void;
};

export async function select_pick(evaluate: PageDeps["evaluate"]): Promise<void> {
  await evaluate(INSPECT_EXPRESSION);
}

export function run_page(deps: PageDeps): void {
  // Picks run one after another, so the evals never overlap.
  let queue: Promise<void> = Promise.resolve();
  const connect = (): void => {
    const port = deps.connect();
    port.postMessage({ type: "devtools_hello", tab_id: deps.tab_id });
    port.onMessage.addListener((message) => {
      if ((message as { type?: string } | undefined)?.type === "devtools_pick") queue = queue.then(() => select_pick(deps.evaluate)).catch(() => {});
    });
    // The background restarting or reloading ends the port. The new background drains a waiting pick when this hello arrives.
    port.onDisconnect.addListener(() => deps.schedule(connect, RECONNECT_MS));
  };
  connect();
}
