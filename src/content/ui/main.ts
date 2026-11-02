// The `ui` bundle: registers the badge and the toast with the host.

import type { BundleHostApi } from "../bundle_host.ts";
import { show_mode_label } from "../mode_indicator.ts";
import type { BadgeColors } from "../mode_indicator.ts";
import { show_toast } from "../toast.ts";

type UiWindow = { oasisfox_host: BundleHostApi; oasisfox_ui_ready?: true };
const page = window as unknown as UiWindow;

// A second run would hold fresh badge and toast state and leave the first copy's surfaces on the page.
if (!page.oasisfox_ui_ready) {
  page.oasisfox_ui_ready = true;
  page.oasisfox_host.register_handler("ui.toast", (args) => show_toast(args.message as string));
  page.oasisfox_host.register_handler("ui.badge", (args) => show_mode_label(args.label as string | undefined, args.colors as BadgeColors | undefined));
}
