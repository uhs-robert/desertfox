// The jump of a global mark: switch to the tab that has the marked address, or open the address in the current tab, then scroll there.
// The scroll comes from the background: it pushes `mark.jump` into the top frame of the target tab, and that page asks for the stored position like any mark jump. The switch and the wait are `address_arrival.ts`.

import { RuntimeRefusal } from "../shared/command.ts";
import type { MarkAnswer, MarkJump } from "../shared/messages.ts";
import { create_address_arrivals, type AddressDeps } from "./address_arrival.ts";
import type { GlobalJump, MarkSender, MarkStore } from "./mark_store.ts";

export { find_mark_tab, type MarkTab } from "./address_arrival.ts";

export type GlobalJumpDeps = Omit<AddressDeps, "failed_text"> & {
  store: MarkStore;
  // Runs `mark.jump` for the key in the top frame of the tab. The reply is the content script's.
  push_jump: (tab_id: number, key: string) => Promise<unknown>;
};

export function create_global_mark_jump(deps: GlobalJumpDeps): GlobalJump {
  const arrivals = create_address_arrivals<string>({ ...deps, failed_text: "Mark jump failed" });
  const push = (tab_id: number, key: string) => deps.push_jump(tab_id, key);

  return async (request: MarkJump, tab: MarkSender): Promise<MarkAnswer> => {
    if (tab.id === undefined || tab.window_id === undefined) throw new RuntimeRefusal("No tab to jump from");
    const { id: tab_id, window_id } = tab;
    if (arrivals.claim_armed(tab_id, (key) => key === request.key)) return deps.store.run(request, tab.incognito);
    const mark = await deps.store.global_of(request.key, tab.incognito);
    if (!mark) throw new RuntimeRefusal(`No mark ${request.key}`);
    const from = { id: tab_id, window_id, incognito: tab.incognito };
    const found = await arrivals.find_tab(mark.url, from);
    // The tab you are on: the scroll is the page's, as for a local mark.
    if (found?.id === tab_id) {
      arrivals.forget(tab_id);
      if (tab.frame_id === 0) return deps.store.run(request, tab.incognito);
      // The frame would scroll its own box and keep its own address, so the top frame jumps instead.
      arrivals.push_now(tab_id, request.key, push);
      return { ok: true };
    }
    await arrivals.go(from, found, mark.url, request.key, push);
    return { ok: true };
  };
}
