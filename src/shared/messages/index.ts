// Type-only. A file imports from the channel file that holds its types. It imports from here when one import names types of two channels, because one import statement per original keeps the bundle bytes unchanged.
export type * from "./content.ts";
export type * from "./page.ts";
export type * from "./ports.ts";
export type * from "./tab.ts";
