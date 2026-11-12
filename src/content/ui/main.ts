// The `ui` bundle: registers the badge and the toast with the host.

import type { BundleHostApi } from "../bundle_host.ts";
import { show_mode_label } from "../mode_indicator.ts";
import type { ToastKind } from "../../shared/messages.ts";
import { mode_label } from "./mode_label.ts";
import type { BadgeState } from "./mode_label.ts";
import { show_toast } from "../toast.ts";

type UiWindow = { desertfox_host: BundleHostApi; desertfox_ui_ready?: true };
const page = window as unknown as UiWindow;

// A second run would hold fresh badge and toast state and leave the first copy's surfaces on the page.
if (!page.desertfox_ui_ready) {
  page.desertfox_ui_ready = true;
  page.desertfox_host.register_handler_("ui.toast", (args) => show_toast(args.message as string, args.duration_ms as number, args.kind as ToastKind | undefined));
  page.desertfox_host.register_handler_("ui.badge", (args) => {
    const { mode, pass_next, setting, recording, site_label } = args as unknown as BadgeState;
    // Full screen shows the video alone. A video in a child frame leaves the top document in full screen too.
    if (mode === "media" && document.fullscreenElement) return show_mode_label(undefined);
    show_mode_label(mode_label(mode, pass_next, setting, recording, site_label), pass_next ? undefined : site_label === undefined ? mode : "site");
  });
}
