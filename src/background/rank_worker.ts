// The Worker behind `rank_service.ts`: it holds the history rows and ranks each open line's list, off the thread that runs the background and the line's page.
import { create_rank_index } from "./rank_index.ts";
import type { FromWorker, ToWorker } from "./rank_index.ts";

const index = create_rank_index((message: FromWorker) => self.postMessage(message));

self.onmessage = (event: MessageEvent<ToWorker>) => index.receive(event.data);
