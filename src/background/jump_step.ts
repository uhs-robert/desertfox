// The messages of the jump list: `jump_push` records a place, `jump_step` moves the cursor and takes the user there.
// A step to a place on the page the user is on answers the offset and the page scrolls. A step to another address switches to the tab that has it, or opens it in the current tab, then scrolls from the background, on `address_arrival.ts`.
// The cursor moves before the move starts. A target that never loads leaves the cursor on it, and the next step goes on from there.

import { RuntimeRefusal } from "../shared/command.ts";
import type { JumpEntry } from "../shared/jump_names.ts";
import { mark_page_url } from "../shared/mark_names.ts";
import type { JumpAnswer, JumpRequest } from "../shared/messages.ts";
import { create_address_arrivals, type AddressDeps } from "./address_arrival.ts";
import type { JumpStore } from "./jump_store.ts";
import type { MarkSender } from "./mark_store.ts";

export type JumpStepDeps = Omit<AddressDeps, "failed_text"> & {
  store: JumpStore;
  // Runs `page.jump` in the top frame of the tab, for a step that a frame asked for or, with `arrival`, for the tab the step went to. The reply is the content script's.
  push_jump: (tab_id: number, steps: number, arrival?: true) => Promise<unknown>;
};

export type JumpAnswerer = (request: JumpRequest, tab: MarkSender | undefined) => Promise<JumpAnswer>;

export function create_jump_step(deps: JumpStepDeps): JumpAnswerer {
  const arrivals = create_address_arrivals<JumpEntry>({ ...deps, failed_text: "Jump failed" });
  // The pushed `page.jump` of an arrival asks for its own entry. Its direction does not matter, the entry is already chosen.
  const push_arrival = (tab_id: number) => deps.push_jump(tab_id, -1, true);

  async function answer(request: JumpRequest, tab: MarkSender | undefined): Promise<JumpAnswer> {
    if (!tab || tab.id === undefined || tab.window_id === undefined || tab.url === undefined) throw new RuntimeRefusal("No page to jump from");
    const { id: tab_id, window_id } = tab;
    if (request.type === "jump_push") {
      if (tab.frame_id !== 0) throw new RuntimeRefusal("The jump list needs the top frame");
      await deps.store.push(window_id, tab.incognito, { url: mark_page_url(tab.url), x: request.x, y: request.y });
      return { ok: true };
    }
    // The page that was sent here asks again, and gets the entry the step chose, whatever address it ended on. Only the pushed request does that: a key the user pressed meanwhile is a step of its own.
    if (request.arrival) {
      const arrived = arrivals.claim_armed(tab_id, () => true);
      // The arrival was superseded or its tab left, so the pushed request has nothing to do.
      return arrived ? { ok: true, x: arrived.data.x, y: arrived.data.y } : { ok: true };
    }
    // The frame would scroll its own box, so the top frame steps instead, from its own offset.
    if (tab.frame_id !== 0) {
      const reply = (await deps.push_jump(tab_id, request.step)) as { ok?: boolean; message?: string } | undefined;
      if (reply?.ok === false) throw new RuntimeRefusal(reply.message ?? "Jump failed");
      return { ok: true };
    }
    const here = { url: mark_page_url(tab.url), x: request.x, y: request.y };
    const entry = await deps.store.step(window_id, tab.incognito, request.step, here);
    if (entry.url === here.url) {
      arrivals.forget(tab_id);
      return { ok: true, x: entry.x, y: entry.y };
    }
    const from = { id: tab_id, window_id, incognito: tab.incognito };
    // A tab in another window has another list, so a step back from there could not come forward again: that address opens here.
    await arrivals.go(from, await arrivals.find_tab(entry.url, from, true), entry.url, entry, push_arrival);
    return { ok: true };
  }

  // The sender is a page script, so a bad request answers as a refusal and never throws into the listener.
  return (request, tab) => answer(request, tab).catch((error: unknown) => ({ ok: false, message: error instanceof Error ? error.message : String(error) }));
}
