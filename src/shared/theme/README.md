# theme

Themes as role colors. A theme file maps its colors onto a fixed list of roles. Pure code, shared by the extension and `tools/build-config`.

Behavior is in `docs/design/config.md`, section "Theme files for the config". See `src/shared/README.md` for how the folder fits in `shared/`.

- `roles.ts`: the public role list.
- `derive.ts`: the one table of what a missing role becomes.
- `theme_file.ts`: checks one parsed theme file and fills it into a full theme.
- `older_tables.ts`: fills the roles a stored theme table from an older version lacks.
- `base16.ts`: reads a base16 or base24 scheme and maps its slots onto the roles.
- `contrast.ts`: the fg_dim contrast clamp, shared by the Oasis build and the base16 importer.
- `tokens.ts`: the CSS custom property name of each role.
- `font_family.ts`: checks a font family list typed into a setting.
- `load.ts`: finds the theme a `theme` name stands for.
- `apply.ts`: turns the stored theme into CSS for one surface and keeps it current.

Rules across files:

- Adding a role is safe. Renaming one breaks contributed themes.
- `load.ts` holds every theme table, so no page or content bundle imports it. `apply.ts` runs in pages and lazy bundles, never in `content.js`.
