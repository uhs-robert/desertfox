// The `ui` bundle: registers the badge and the toast with the host.

import type { BundleHostApi } from "../bundle_host.ts";
import { show_mode_label } from "../mode_indicator.ts";
import type { ToastKind } from "../../shared/messages.ts";
import { show_toast_ } from "../toast.ts";

type UiWindow = { desertfox_host: BundleHostApi; desertfox_ui_ready?: true };
const page = window as unknown as UiWindow;

// A second run would hold fresh badge and toast state and leave the first copy's surfaces on the page.
if (!page.desertfox_ui_ready) {
  page.desertfox_ui_ready = true;
  page.desertfox_host.register_handler_("ui.toast", (args) => show_toast_(args.message as string, args.kind as ToastKind | undefined));
  page.desertfox_host.register_handler_("ui.badge", (args) => show_mode_label(args.label as string | undefined, args.mode as string | undefined));
}
