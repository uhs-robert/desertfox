import type { Refusal, BackgroundToContent, ToastKind } from "../shared/messages/index.ts";

export type RefusalChannels = {
  send_to_tab: (tab_id: number, message: BackgroundToContent, frame_id?: number) => Promise<unknown>;
  // Puts the message in the status bar's slot for the tab. Gives false when no bar shows it.
  show_in_bar?: (tab_id: number, text: string, kind: ToastKind) => Promise<boolean>;
  notify: (refusal: Refusal) => Promise<unknown>;
};

export type RefusalPath = "toast" | "bar" | "notification";

// A toast needs a content script in the tab. Without one the send rejects,
// which covers about: pages, the PDF viewer and AMO, so the status bar takes over, and a notification when no bar shows.
export async function deliver_toast(
  channels: RefusalChannels,
  tab_id: number | undefined,
  refusal: Refusal,
  kind: ToastKind,
  frame_id?: number,
): Promise<RefusalPath> {
  if (tab_id !== undefined) {
    try {
      // An error leaves `kind` out, so the message is the one a refusal always sent.
      await channels.send_to_tab(tab_id, kind === "error" ? { type: "refusal", refusal } : { type: "refusal", refusal, kind }, frame_id);
      return "toast";
    } catch {
      // Falls through to the bar.
    }
    if (await channels.show_in_bar?.(tab_id, refusal.message, kind)) return "bar";
  }
  await channels.notify(refusal);
  return "notification";
}

export const deliver_refusal = (channels: RefusalChannels, tab_id: number | undefined, refusal: Refusal, frame_id?: number): Promise<RefusalPath> =>
  deliver_toast(channels, tab_id, refusal, "error", frame_id);
