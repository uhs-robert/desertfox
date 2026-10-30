import type { BackgroundToContent, Refusal } from "../shared/messages.ts";

export type RefusalChannels = {
  send_to_tab: (tab_id: number, message: BackgroundToContent) => Promise<unknown>;
  notify: (refusal: Refusal) => Promise<unknown>;
};

export type RefusalPath = "toast" | "notification";

// A toast needs a content script in the tab. Without one the send rejects,
// which covers about: pages, the PDF viewer and AMO, so a notification takes over.
export async function deliver_refusal(
  channels: RefusalChannels,
  tab_id: number | undefined,
  refusal: Refusal,
): Promise<RefusalPath> {
  if (tab_id !== undefined) {
    try {
      await channels.send_to_tab(tab_id, { type: "refusal", refusal });
      return "toast";
    } catch {
      // Falls through to the notification.
    }
  }
  await channels.notify(refusal);
  return "notification";
}
