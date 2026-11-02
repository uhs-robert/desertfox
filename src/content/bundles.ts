// The one bundle host of this frame. Handlers, the key flow and main.ts share it.

import { create_bundle_host } from "./bundle_host.ts";

export const bundles = create_bundle_host();
