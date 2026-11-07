import { create_registry } from "./define.ts";

// The registry the extension uses. Command modules call `define` on import. Only the background page and Node tools import this file, because the call runs at import and keeps define.ts and the setting rules in the bundle.
export const registry = create_registry();
export const define = registry.define;
