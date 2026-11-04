# themes

Theme data. `src/shared/themes.ts` is generated from this folder by `just themes`, and `just test` fails when it is stale.

- `oasis/`: the 16 Oasis themes as byte copies of the oasis.nvim CSS files, 96 in all: one dark file and five light files (`light_1` to `light_5`) per theme. Do not edit them. `just oasis-themes <oasis.nvim dir>` copies them again and regenerates the module. `tools/build_themes.ts` picks each role from one `--oasis-*` variable, and its table says which. A theme is named after its file: `oasis_moonlight`.
- `<name>.toml`: a contributed theme. A `[dark]` table, a `[light]` table or both, each mapping a role to a `#rgb` or `#rrggbb` color. A file with one table serves both system settings. `bg_core`, `fg_core`, `primary` and `accent` are required, and every other role derives when missing. The roles and the rules are in `docs/design.md`, under Themes. A name that an Oasis theme already uses is an error.

A user's own themes go in `<config dir>/themes/<name>.toml` and use the same format.
