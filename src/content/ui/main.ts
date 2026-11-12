// The `ui` bundle: registers the badge, the toast and the hand-off of a hidden input frame with the host.

import type { PageHostApi } from "../bundle_host.ts";
import { show_mode_label } from "../mode_indicator.ts";
import type { ToastKind } from "../../shared/messages.ts";
import { hand_focus_to_parent } from "./hand_focus.ts";
import { mode_label } from "./mode_label.ts";
import type { BadgeState } from "./mode_label.ts";
import { show_toast } from "../toast.ts";

type UiWindow = { desertfox_host: PageHostApi; desertfox_ui_ready?: true };
const page = window as unknown as UiWindow;

// A second run would hold fresh badge and toast state and leave the first copy's surfaces on the page.
if (!page.desertfox_ui_ready) {
  page.desertfox_ui_ready = true;
  page.desertfox_host.register_handler_("ui.toast", (args) => show_toast(args.message as string, args.kind as ToastKind | undefined));
  page.desertfox_host.register_handler_("ui.hand_focus", (args) => hand_focus_to_parent(page.desertfox_host.get_mode(), page.desertfox_host.is_editable_, args.keep_field as boolean));
  page.desertfox_host.register_handler_("ui.badge", (args) => {
    const { mode, pass_next, setting, recording, site_label } = args as unknown as BadgeState;
    // Full screen shows the video alone. A video in a child frame leaves the top document in full screen too.
    if (mode === "media" && document.fullscreenElement) return show_mode_label(undefined);
    show_mode_label(mode_label(mode, pass_next, setting, recording, site_label), pass_next ? undefined : site_label === undefined ? mode : "site");
  });
}
