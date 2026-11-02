// The `ui` bundle: registers the badge and the toast with the host.

import type { BundleHostApi } from "../bundle_host.ts";
import { show_mode_label } from "../mode_indicator.ts";
import type { BadgeColors } from "../mode_indicator.ts";
import { show_toast } from "../toast.ts";

const host = (window as unknown as { oasisfox_host: BundleHostApi }).oasisfox_host;

host.register_handler("ui.toast", (args) => show_toast(args.message as string));
host.register_handler("ui.badge", (args) => show_mode_label(args.label as string | undefined, args.colors as BadgeColors | undefined));
