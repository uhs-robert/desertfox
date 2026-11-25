// The data kinds of the config folder, one `<kind>.toml` and `<kind>.d/` each. Kept apart from config_build so a page can name them without bundling the build.

export const DATA_KINDS = ["keymap", "search_engines", "command_aliases", "quickmarks", "settings"] as const;
export type DataKind = (typeof DATA_KINDS)[number];
