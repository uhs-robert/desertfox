// The devtools page: selects each pick the background relays in the Inspector. Both expressions are constants and carry no page data. The picked node never travels as text: the hints bundle left it on the page window, and `inspect()` takes it from there.

export const INSPECT_EXPRESSION = "inspect(window.__desertfox_pick)";
export const CLEAR_EXPRESSION = "delete window.__desertfox_pick";

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

// The property goes whether the select worked or not, so a failed pick leaves nothing on the page.
export async function select_pick(evaluate: PageDeps["evaluate"]): Promise<void> {
  try {
    await evaluate(INSPECT_EXPRESSION);
  } finally {
    await evaluate(CLEAR_EXPRESSION).catch(() => {});
  }
}

export function run_page(deps: PageDeps): void {
  // Picks run one after another, so the clear of one never takes the node of the next.
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
