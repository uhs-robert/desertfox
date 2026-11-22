// The panel the background opens when the top frame enters the media mode.

import type { Mode } from "../../shared/command.ts";

// The background decided to open the panel a moment ago. An Escape or a full screen that came since wins, so the check and the draw happen together in the frame.
export const media_panel_admitted = (mode: Mode, in_full_screen: boolean): boolean => mode === "media" && !in_full_screen;
