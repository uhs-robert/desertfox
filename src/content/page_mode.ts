// The one mode state of this frame. Handlers and the key listener share it.

import { create_mode_state } from "./mode_state.ts";

export const page_mode = create_mode_state();
