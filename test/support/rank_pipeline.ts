// The ranked lists end to end in one process: the page's ranked client, a fake rank port, the background's rank service and a fake Worker that runs the real rank index.
// Every hop is a message delivered later and in order, as `postMessage` delivers them, so tests can drive races between the hops.
// Each hop copies its message when it is posted, as the browser does, so a sender that changes the object afterwards changes nothing on the way.
import { create_rank_index } from "../../src/background/rank_index.ts";
import type { FromWorker, ToWorker } from "../../src/background/rank_index.ts";
import { frame_asker_of } from "../../src/background/cmdline_panel.ts";
import { create_rank_service } from "../../src/background/rank_service.ts";
import type { RankPort, RankServiceDeps, RankWorker } from "../../src/background/rank_service.ts";
import type { HistoryNode, RankInputs } from "../../src/background/completion_rank.ts";
import type { Asker } from "../../src/background/complete_items.ts";
import { create_ranked_client } from "../../src/shared/completion/ranked_client.ts";
import { RANK_PORT_NAME } from "../../src/shared/rank_port.ts";
import type { RankPush, RankRequest } from "../../src/shared/rank_port.ts";

export type Visit = { url?: string | undefined; title?: string | undefined; lastVisitTime?: number | undefined; visitCount?: number | undefined };

export const visit_of = (node: HistoryNode): Visit => ({ url: node.url, title: node.title, lastVisitTime: node.last_visit, visitCount: node.visit_count });

export type PipelineOptions = {
  // What `history.search` answers, newest first.
  history: () => Visit[];
  inputs: (source: RankInputs["source"], asker: Asker) => Promise<RankInputs>;
  is_opener?: (tab_id: number, frame_id: number) => Promise<boolean>;
  // Whether a new Worker loads. False makes it fail before `ready`, as a script that cannot load does.
  worker_loads?: () => boolean;
  // Whether a new Worker crashes just after it loads, as one that runs out of memory during its fill does.
  crashes_after_start?: () => boolean;
  // Messages to the Worker that it never handles, as a Worker that hangs.
  worker_ignores?: (message: ToWorker) => boolean;
  // The service's restart waits, scaled, so a test need not wait seconds.
  timer_scale?: number;
};

export type FakeWorker = { index: ReturnType<typeof create_rank_index> | undefined; terminated: boolean; crash: () => void; received: ToWorker[] };

export function rank_pipeline(options: PipelineOptions) {
  let in_transit = 0;
  const later = (deliver: () => void) => {
    in_transit++;
    setImmediate(() => {
      in_transit--;
      deliver();
    });
  };
  const workers: FakeWorker[] = [];
  // Held fills: a test releases them to choose when the history arrives.
  const held_searches: (() => void)[] = [];
  let hold_searches = false;

  const start_worker = (): RankWorker => {
    const loads = options.worker_loads?.() ?? true;
    const fake: FakeWorker = { index: undefined, terminated: false, crash: () => {}, received: [] };
    const worker: RankWorker = {
      onmessage: null,
      onerror: null,
      postMessage: (message) => {
        const sent = structuredClone(message);
        later(() => {
          if (fake.terminated || !fake.index || options.worker_ignores?.(sent)) return;
          fake.received.push(sent);
          fake.index.receive(structuredClone(sent));
        });
      },
      terminate: () => void (fake.terminated = true),
    };
    fake.crash = () => worker.onerror?.({ message: "crash" });
    // The script loads a moment after the Worker is made, before any message is handled.
    later(() => {
      if (fake.terminated) return;
      if (!loads) return worker.onerror?.({ message: "load failed" });
      fake.index = create_rank_index((message: FromWorker) => {
        const sent = structuredClone(message);
        later(() => !fake.terminated && worker.onmessage?.({ data: sent }));
      });
      if (options.crashes_after_start?.()) later(() => !fake.terminated && worker.onerror?.({ message: "out of memory" }));
    });
    workers.push(fake);
    return worker;
  };

  const scale = options.timer_scale ?? 1;
  // Every wait the service asked for, unscaled, in order.
  const timer_delays: number[] = [];
  // Added to the clock the service reads, so a test can age a Worker without waiting.
  let clock_offset_ms = 0;
  const deps: RankServiceDeps = {
    start_worker,
    search: async (max) => {
      if (hold_searches) await new Promise<void>((resolve) => held_searches.push(resolve));
      return options.history().slice(0, max);
    },
    listed: async (url) => options.history().some((visit) => visit.url === url),
    fallback: async () => options.history().slice(0, 1000).map((visit) => ({ url: visit.url, title: visit.title, last_visit: visit.lastVisitTime, visit_count: visit.visitCount })),
    inputs: options.inputs,
    is_opener: options.is_opener ?? (async () => true),
    is_line_page: () => true,
    asker_of: async (sender) => frame_asker_of(sender),
    set_timer: (callback, delay_ms) => {
      timer_delays.push(delay_ms);
      return setTimeout(callback, delay_ms * scale);
    },
    clear_timer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    now: () => Date.now() + clock_offset_ms,
  };
  const service = create_rank_service(deps);

  // One line's page end: a ranked client over a fake port to the service.
  const line = (on_ready: () => void = () => {}, sender = { tab: { id: 1, windowId: 1, incognito: false }, frameId: 0, url: "moz-extension://x/cmdline.html" }) => {
    const to_background = { message: [] as ((message: unknown) => void)[], disconnect: [] as (() => void)[] };
    let open = true;
    let connected = false;
    let disconnected_by_background = false;
    const background_port: RankPort = {
      name: RANK_PORT_NAME,
      sender,
      postMessage: (message) => {
        const sent = structuredClone(message);
        later(() => open && client.receive(sent));
      },
      disconnect: () => {
        open = false;
        disconnected_by_background = true;
        later(() => {
          client.end();
          on_ready();
        });
      },
      onMessage: { addListener: (listener) => void to_background.message.push(listener) },
      onDisconnect: { addListener: (listener) => void to_background.disconnect.push(listener) },
    };
    const sent: RankRequest[] = [];
    const client = create_ranked_client({
      send: (request) => {
        if (!connected) {
          connected = true;
          service.connect(background_port);
        }
        sent.push(request);
        const copy = structuredClone(request);
        later(() => open && to_background.message.forEach((listener) => listener(copy)));
      },
      on_ready,
    });
    return {
      client,
      sent,
      // The page sends its own message straight to the background, as a page script can.
      post: (message: unknown) => {
        if (!connected) {
          connected = true;
          service.connect(background_port);
        }
        const copy = structuredClone(message);
        later(() => open && to_background.message.forEach((listener) => listener(copy)));
      },
      // The line closes: the client ends and the port goes.
      close: () => {
        client.end();
        open = false;
        later(() => to_background.disconnect.forEach((listener) => listener()));
      },
      disconnected_by_background: () => disconnected_by_background,
      // Pushes as the page receives them, for a test that watches the port.
      receive_hook: (hook: (message: RankPush) => void) => {
        const receive = client.receive;
        client.receive = (message) => {
          hook(message);
          receive(message);
        };
      },
    };
  };

  return {
    service,
    workers,
    timer_delays,
    pass_time: (ms: number) => void (clock_offset_ms += ms),
    line,
    hold_searches: () => void (hold_searches = true),
    release_searches: () => {
      hold_searches = false;
      held_searches.splice(0).forEach((resolve) => resolve());
    },
    // Waits until no message is in transit and the promise chains and zero-delay timers between them have run.
    settle: async () => {
      for (let quiet = 0; quiet < 5; ) {
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setTimeout(resolve, 0));
        quiet = in_transit === 0 ? quiet + 1 : 0;
      }
    },
  };
}
