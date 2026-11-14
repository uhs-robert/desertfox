# themes

Theme data. `src/shared/themes.ts` is generated from this folder by `just themes`, and `just test` fails when it is stale.

- `oasis/`: the 16 Oasis themes as byte copies of the oasis.nvim CSS files, 96 in all: one dark file and five light files (`light_1` to `light_5`) per theme. Do not edit them. `just oasis-themes <oasis.nvim dir>` copies them again and regenerates the module. `tools/build_themes.ts` picks each role from one `--oasis-*` variable, and its table says which. The build raises `fg_dim` (and so `mode_ignore`) to 3:1 on `bg_core` and `bg_mantle`, so the generated module differs from the CSS there. A theme is named after its file: `oasis_moonlight`.
- `<name>.toml`: a contributed theme. A `[dark]` table, a `[light]` table or both, each mapping a role to a color: `#rgb`, `#rrggbb`, `rgb()`, `rgba()` with alpha 1 or `hsl()`. Each is stored as `#rrggbb`. A file with one table serves both system settings. `bg_core`, `fg_core`, `primary` and `accent` are required, and every other role derives when missing. The roles and the rules are in `docs/design.md`, under Themes. A name that an Oasis theme already uses is an error.

- `NOTICE.md` and `LICENSE-Apache-2.0.txt`: the credit and license of each scheme the contributed themes take colors from. The build copies both into the package.
- Built-in families: `catppuccin` (Mocha and Latte), `tokyo_night` (Night and Day), `gruvbox` (medium dark and light), `dracula` (Dracula and Alucard), `nord` (dark only, one table) and `rose_pine` (main and Dawn). Other flavors are separate names: `catppuccin_frappe`, `catppuccin_macchiato`, `tokyo_night_storm`, `tokyo_night_moon`, `gruvbox_hard`, `gruvbox_soft` and `rose_pine_moon`. The colors come from each scheme's official palette, not from base16 ports.

A user's own themes go in `<config dir>/themes/<name>.toml` and use the same format.
