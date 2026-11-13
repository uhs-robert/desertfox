// The jump of a global mark: switch to the tab that has the marked address, or open the address in the current tab, then scroll there.
// The scroll comes from the background: it pushes `mark.jump` into the top frame of the target tab, and that page asks for the stored position like any mark jump. The switch and the wait are `address_arrival.ts`.

import { RuntimeRefusal } from "../shared/command.ts";
import type { JumpEntry } from "../shared/jump_names.ts";
import { mark_page_url } from "../shared/mark_names.ts";
import type { MarkAnswer, MarkJump } from "../shared/messages.ts";
import { create_address_arrivals, type AddressDeps } from "./address_arrival.ts";
import { read_place_in_time, type PageOffset } from "./router.ts";
import type { GlobalJump, MarkSender, MarkStore } from "./mark_store.ts";
import { warn_and_go } from "../shared/swallow.ts";

export { find_mark_tab, type MarkTab } from "./address_arrival.ts";

export type GlobalJumpDeps = Omit<AddressDeps, "failed_text"> & {
  store: MarkStore;
  // Runs `mark.jump` for the key in the top frame of the tab, with the `arrival` its request sends back. The reply is the content script's.
  push_jump: (tab_id: number, key: string, arrival: number) => Promise<unknown>;
  // Puts the place a jump left into a window's jump list. The router records other jumps, but only this knows the window a global mark lands in.
  record_jump: (window_id: number, is_private: boolean, entry: JumpEntry) => Promise<unknown>;
  // The scroll offset of the tab's top frame, for a jump a child frame asked for.
  read_top_offset: (tab_id: number) => Promise<PageOffset | undefined>;
};

export function create_global_mark_jump(deps: GlobalJumpDeps): GlobalJump {
  const arrivals = create_address_arrivals<string>({ ...deps, failed_text: "Mark jump failed" });

  // Where the top frame of the sender's tab stands. The read is the router's, so a frame that never answers cannot hold the jump and another page's answer records nothing.
  async function place_left(request: MarkJump, tab: MarkSender): Promise<JumpEntry | undefined> {
    if (tab.url === undefined || tab.id === undefined) return undefined;
    if (tab.frame_id === 0) return { url: mark_page_url(tab.url), x: request.x, y: request.y };
    return read_place_in_time(deps.read_top_offset(tab.id), tab.url);
  }
  // In the list of the window the jump lands in, so `<C-o>` there comes back.
  const record = async (window_id: number, is_private: boolean, left: JumpEntry | undefined) => {
    if (left) await deps.record_jump(window_id, is_private, left).catch(warn_and_go("deps.record_jump"));
  };

  return async (request: MarkJump, tab: MarkSender): Promise<MarkAnswer> => {
    if (tab.id === undefined || tab.window_id === undefined) throw new RuntimeRefusal("No tab to jump from");
    const { id: tab_id, window_id } = tab;
    // The page that was sent here asks again, and scrolls whatever address it ended on. A late request of a jump that a newer one superseded does nothing.
    if (request.arrival !== undefined) return arrivals.claim_armed(tab_id, request.arrival) ? deps.store.run(request, tab.incognito) : { ok: true };
    const mark = await deps.store.global_of(request.key, tab.incognito);
    if (!mark) throw new RuntimeRefusal(`No mark ${request.key}`);
    const from = { id: tab_id, window_id, incognito: tab.incognito };
    const found = await arrivals.find_tab(mark.url, from);
    // The tab you are on: the scroll is the page's, as for a local mark.
    if (found?.id === tab_id) {
      arrivals.forget(tab_id);
      // The frame would scroll its own box and keep its own address, so the top frame jumps instead. Its pushed request claims the arrival and records nothing, so the place is recorded here, before the top frame moves.
      if (tab.frame_id !== 0) {
        await record(window_id, tab.incognito, await place_left(request, tab));
        arrivals.push_now(tab_id, request.key, deps.push_jump);
        return { ok: true };
      }
      const answer = await deps.store.run(request, tab.incognito);
      await record(window_id, tab.incognito, await place_left(request, tab));
      return answer;
    }
    const left = await place_left(request, tab);
    // A newer jump superseded this one before it switched, so it left nothing.
    if (await arrivals.go(from, found, mark.url, request.key, deps.push_jump)) await record(found?.window_id ?? window_id, tab.incognito, left);
    return { ok: true };
  };
}
