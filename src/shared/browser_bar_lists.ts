// The names the browser module's status bar offers. Apart from `settings_table.ts` so the protocol and the locked page shim read them without pulling the whole settings table.

// The items either side of the browser bar can list.
export const BROWSER_BAR_BORDERS = ["none", "auto", "square", "round", "chamfer"] as const;
export const BROWSER_BAR_WIDGETS = ["mode", "pending", "recording", "container", "scroll", "tabs", "url"] as const;
