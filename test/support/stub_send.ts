import type { Ask, PageRequests, RequestOf } from "../../src/shared/messages/map.ts";

// A help page test stands in for the background and answers what the test scripts, so the answers are not checked against the map.
export function stub_send<K extends keyof PageRequests>(stub: (message: RequestOf<PageRequests, K>) => Promise<unknown>): Ask<Pick<PageRequests, K>> {
  return stub as unknown as Ask<Pick<PageRequests, K>>;
}
