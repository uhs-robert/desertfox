// A bundle in a subframe asks the background to run one of its handlers in the top frame or in another frame of the tab. `shared/relay.ts` is the allow list.

import type { Outcome } from "../shared/messages.ts";
import { refused_as } from "../shared/swallow.ts";

// What the handler answered over there, or undefined when the background refused or the frame never answered.
export const relay_outcome = (to: "top" | number, id: string, args: Record<string, unknown>): Promise<Outcome | undefined> =>
  refused_as(browser.runtime.sendMessage({ type: "relay", to, id, args }) as Promise<Outcome | undefined>, undefined);

// Whether the handler ran and did not fail. A caller that can draw in its own frame does so when this is false.
export const relay = async (to: "top" | number, id: string, args: Record<string, unknown>): Promise<boolean> => (await relay_outcome(to, id, args))?.ok === true;
